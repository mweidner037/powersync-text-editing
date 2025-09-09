import { usePowerSync } from '@powersync/react';
import { AbstractPowerSyncDatabase, sanitizeSQL } from '@powersync/web';
import { useEffect, useState } from 'react';

export class ServerReconciler<S, U> {
  private localState: S;
  private serverState: S;
  /** Map from id to update. Traversal order = application order. */
  private pendingLocalUpdates = new Map<string, U>();

  constructor(
    private readonly initialState: S,
    private readonly reducer: (state: S, updates: U[]) => S,
    private readonly clone: (state: S) => S
  ) {
    this.serverState = clone(initialState);
    this.localState = this.serverState;
  }

  get state(): S {
    return this.localState;
  }

  applyLocalUpdates(updates: { id: string; update: U }[]): void {
    if (updates.length === 0) return;

    if (this.pendingLocalUpdates.size === 0) {
      this.localState = this.clone(this.serverState);
    }
    this.localState = this.reducer(
      this.localState,
      updates.map(({ update }) => update)
    );
    for (const update of updates) {
      this.pendingLocalUpdates.set(update.id, update.update);
    }
  }

  applyServerUpdates(updates: { id: string; update: U }[]): void {
    if (updates.length === 0) return;

    this.serverState = this.reducer(
      this.serverState,
      updates.map(({ update }) => update)
    );
    for (const update of updates) {
      this.pendingLocalUpdates.delete(update.id);
    }
    this.rerunPending();
  }

  applyUpdates(server: { id: string; update: U }[], local: { id: string; update: U }[]): void {
    if (server.length === 0) {
      // Opt: Skip rerunPending in this case.
      this.applyLocalUpdates(local);
      return;
    }

    this.serverState = this.reducer(
      this.serverState,
      server.map(({ update }) => update)
    );
    for (const update of server) {
      this.pendingLocalUpdates.delete(update.id);
    }
    for (const update of local) {
      this.pendingLocalUpdates.set(update.id, update.update);
    }
    this.rerunPending();
  }

  /**
   * Delete a pending local update.
   *
   * You don't need to call this for server echoes of local updates -
   * applyServerUpdates will delete those automatically. Instead, use this
   * to delete local updates that the server rejected or changed ids.
   */
  deletePending(ids: string[]): void {
    let changed = false;
    for (const id of ids) {
      changed ||= this.pendingLocalUpdates.delete(id);
    }
    if (changed) this.rerunPending();
  }

  private rerunPending(): void {
    if (this.pendingLocalUpdates.size === 0) {
      this.localState = this.serverState;
    } else {
      this.localState = this.clone(this.serverState);
      // We rely on Map's iteration in order added.
      this.localState = this.reducer(this.localState, [...this.pendingLocalUpdates.values()]);
    }
  }
}

/**
 * Applies [Server Reconciliation](https://mattweidner.com/2024/06/04/server-architectures.html#1-server-reconciliation)
 * to a PowerSync table that is a log of updates.
 *
 * @param S The state type.
 * @param U The parsed type of updates in the table (stored as JSON string).
 */
export class PowerSyncServerReconciler<S, U> {
  // Event handlers (lazy coding).
  onLoaded?: () => void;
  onStateChange?: (state: S) => void;

  private readonly reconciler: ServerReconciler<S, U>;
  private readonly trackPromise: Promise<() => Promise<void>>;

  constructor(
    readonly powerSync: AbstractPowerSyncDatabase,
    readonly tableName: string,
    readonly docId: string,
    initialState: S,
    reducer: (state: S, updates: U[]) => S,
    clone: (state: S) => S
  ) {
    this.reconciler = new ServerReconciler(initialState, reducer, clone);

    const docQuery = sanitizeSQL`json_extract(NEW.data, '$.doc_id') = ${docId}`;
    this.trackPromise = powerSync.triggers.trackTableDiff({
      source: tableName,
      columns: ['update', 'server_version'],
      when: { INSERT: docQuery, UPDATE: docQuery },
      onChange: async (context) => {
        const server: { id: string; update: U }[] = [];
        const local: { id: string; update: U }[] = [];

        const changedRows = await context.withDiff<{ id: string; update: string; is_committed: number }>(
          `SELECT id, "update", (server_version IS NOT NULL) as is_committed FROM
          (
            SELECT
              mt.id,
              CAST(json_extract(mt.data, '$.update') as TEXT) AS "update",
              CAST(json_extract(mt.data, '$.server_version') as INTEGER) AS server_version,
              mt.rowid
            FROM "ps_data__${tableName}" mt
            JOIN DIFF ON DIFF.id = mt.id
          )
          ORDER BY server_version NULLS LAST, rowid`
        );
        for (const changedRow of changedRows) {
          const update = JSON.parse(changedRow.update) as U;
          (changedRow.is_committed ? server : local).push({ id: changedRow.id, update });
        }

        // TODO: Handle deletes (time travel)?

        this.reconciler.applyUpdates(server, local);
        this.onStateChange?.(this.state);
      }
    });

    // Do the initial query after setting up the trigger so we don't miss any rows.
    // TODO: What if there is overlap?
    this.trackPromise.then(() => this.initialLoad());
  }

  private async initialLoad() {
    const initialRows = await this.powerSync.getAll<{ id: string; update: string; is_committed: number }>(
      `SELECT id, "update", (server_version IS NOT NULL) as is_committed FROM
      (
        SELECT
          mt.id,
          CAST(json_extract(mt.data, '$.doc_id') as TEXT) AS doc_id,
          CAST(json_extract(mt.data, '$.update') as TEXT) AS "update",
          CAST(json_extract(mt.data, '$.server_version') as INTEGER) AS server_version,
          mt.rowid
        FROM "ps_data__${this.tableName}" mt
      )
      WHERE doc_id=?
      ORDER BY server_version NULLS LAST, rowid`,
      [this.docId]
    );

    const server: { id: string; update: U }[] = [];
    const local: { id: string; update: U }[] = [];
    for (const initialRow of initialRows) {
      const update = JSON.parse(initialRow.update) as U;
      (initialRow.is_committed ? server : local).push({ id: initialRow.id, update });
    }

    this.reconciler.applyUpdates(server, local);
    this.onStateChange?.(this.state);
    this.onLoaded?.();
  }

  get state(): S {
    return this.reconciler.state;
  }

  async destroy() {
    const stop = await this.trackPromise;
    await stop();
  }
}

// TODO: Way to ignore the state until your latest local update has been
// incorporated (or rejected?). Move inserter here and stack on top?
// Await insertion + some other condition?

export function useServerReconciliation<S, U>(
  tableName: string,
  docId: string,
  initialState: S,
  reducer: (state: S, updates: U[]) => S,
  clone: (state: S) => S
): { state: S; isLoading: boolean } {
  const powerSync = usePowerSync();

  const [isLoading, setIsLoading] = useState(true);
  const [state, setState] = useState<S>(initialState);

  useEffect(
    () => {
      const reconciler = new PowerSyncServerReconciler(powerSync, tableName, docId, initialState, reducer, clone);
      reconciler.onLoaded = () => setIsLoading(false);
      reconciler.onStateChange = setState;

      setIsLoading(true);

      return () => {
        reconciler.onLoaded = undefined;
        reconciler.onStateChange = undefined;
        void reconciler.destroy();
      };
    },
    // Don't watch initialState, reducer, or clone in case they change identities without
    // actually changing (caller forgot to useMemo / useCallback).
    [tableName, docId]
  );

  return { state, isLoading };
}
