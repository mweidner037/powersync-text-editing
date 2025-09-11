import {
  AbstractPowerSyncDatabase,
  BaseObserver,
  CrudEntry,
  PowerSyncBackendConnector,
  UpdateType,
  type PowerSyncCredentials
} from '@powersync/web';

import { Session, SupabaseClient, createClient } from '@supabase/supabase-js';
import { PRESENCE_TABLE } from './AppSchema';

export type SupabaseConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  powersyncUrl: string;
};

/// Postgres Response codes that we cannot recover from by retrying.
const FATAL_RESPONSE_CODES = [
  // Class 22 — Data Exception
  // Examples include data type mismatch.
  new RegExp('^22...$'),
  // Class 23 — Integrity Constraint Violation.
  // Examples include NOT NULL, FOREIGN KEY and UNIQUE violations.
  new RegExp('^23...$'),
  // INSUFFICIENT PRIVILEGE - typically a row-level security violation
  new RegExp('^42501$')
];

export type SupabaseConnectorListener = {
  initialized: () => void;
  sessionStarted: (session: Session) => void;
};

export class SupabaseConnector extends BaseObserver<SupabaseConnectorListener> implements PowerSyncBackendConnector {
  readonly client: SupabaseClient;
  readonly config: SupabaseConfig;

  ready: boolean;

  currentSession: Session | null;
  isUserless = false;

  constructor() {
    super();
    this.config = {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      powersyncUrl: import.meta.env.VITE_POWERSYNC_URL,
      supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    };

    this.client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      auth: {
        persistSession: true
      }
    });
    this.currentSession = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) {
      return;
    }

    const sessionResponse = await this.client.auth.getSession();
    this.updateSession(sessionResponse.data.session);

    this.ready = true;
    this.iterateListeners((cb) => cb.initialized?.());
  }

  async login(username: string, password: string) {
    const {
      data: { session },
      error
    } = await this.client.auth.signInWithPassword({
      email: username,
      password: password
    });

    if (error) {
      throw error;
    }

    this.updateSession(session);
  }

  /**
   * Login as a new anonymous user.
   */
  async anonLogin() {
    const {
      data: { session },
      error
    } = await this.client.auth.signInAnonymously();

    if (error) {
      throw error;
    }

    this.updateSession(session);
  }

  /**
   * "Login" just enough to connect to Supabase, but set userless to true,
   * blocking access to the homepage.
   */
  async userlessLogin() {
    const {
      data: { session },
      error
    } = await this.client.auth.signInAnonymously();

    if (error) {
      throw error;
    }

    this.updateSession(session, true);
  }

  async fetchCredentials() {
    const {
      data: { session },
      error
    } = await this.client.auth.getSession();

    if (!session || error) {
      throw new Error(`Could not fetch Supabase credentials: ${error}`);
    }

    console.debug('session expires at', session.expires_at);

    return {
      endpoint: this.config.powersyncUrl,
      token: session.access_token ?? ''
    } satisfies PowerSyncCredentials;
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    // Upload data following the pre-sorted batch strategy from
    // https://docs.powersync.com/tutorials/client/performance/supabase-connector-performance.
    // This ensures that rapid updates (to text and shared cursors) are sent in batches
    // instead of one at a time with awaits in between.

    const transaction = await database.getCrudBatch();

    if (!transaction) {
      return;
    }

    try {
      // Group operations by type and table
      const putOps: { [table: string]: any[] } = {};
      const deleteOps: { [table: string]: string[] } = {};
      let patchOps: CrudEntry[] = [];

      // Organize operations
      for (const op of transaction.crud) {
        switch (op.op) {
          case UpdateType.PUT:
            // Skip old presence rows as described in the usePresence docs.
            if (op.table === PRESENCE_TABLE && Date.now() >= op.opData!.expires_at_local * 1000) {
              continue;
            }
            if (!putOps[op.table]) {
              putOps[op.table] = [];
            }
            putOps[op.table].push({ ...op.opData, id: op.id });
            break;
          case UpdateType.PATCH:
            patchOps.push(op);
            break;
          case UpdateType.DELETE:
            if (!deleteOps[op.table]) {
              deleteOps[op.table] = [];
            }
            deleteOps[op.table].push(op.id);
            break;
        }
      }

      // Execute bulk operations
      for (const table of Object.keys(putOps)) {
        const result = await this.client.from(table).upsert(putOps[table]);
        if (result.error) {
          console.error(result.error);
          throw new Error(`Could not bulk PUT data to Supabase table ${table}: ${JSON.stringify(result)}`);
        }
      }

      for (const table of Object.keys(deleteOps)) {
        const result = await this.client.from(table).delete().in('id', deleteOps[table]);
        if (result.error) {
          console.error(result.error);
          throw new Error(`Could not bulk DELETE data from Supabase table ${table}: ${JSON.stringify(result)}`);
        }
      }

      // Execute PATCH operations individually since they can't be easily batched
      for (const op of patchOps) {
        const result = await this.client.from(op.table).update(op.opData).eq('id', op.id);
        if (result.error) {
          console.error(result.error);
          throw new Error(`Could not PATCH data in Supabase: ${JSON.stringify(result)}`);
        }
      }

      await transaction.complete();
    } catch (ex: any) {
      console.debug(ex);
      if (typeof ex.code == 'string' && FATAL_RESPONSE_CODES.some((regex) => regex.test(ex.code))) {
        /**
         * Instead of blocking the queue with these errors,
         * discard the (rest of the) transaction.
         *
         * Note that these errors typically indicate a bug in the application.
         * If protecting against data loss is important, save the failing records
         * elsewhere instead of discarding, and/or notify the user.
         */
        console.error('Data upload error - discarding transaction:', ex);
        await transaction.complete();
      } else {
        // Error may be retryable - e.g. network error or temporary server error.
        // Throwing an error here causes this call to be retried after a delay.
        throw ex;
      }
    }
  }

  updateSession(session: Session | null, isUserless = false) {
    this.currentSession = session;
    this.isUserless = isUserless;
    if (!session) {
      return;
    }
    this.iterateListeners((cb) => cb.sessionStarted?.(session));
  }
}
