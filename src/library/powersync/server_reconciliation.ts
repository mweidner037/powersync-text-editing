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
    private readonly reducer: (state: S, update: U) => S,
    private readonly clone: (state: S) => S
  ) {
    this.serverState = clone(initialState);
    this.localState = this.serverState;
  }

  get state(): S {
    return this.localState;
  }

  applyLocalUpdates(updates: { id: string; update: U }[]): void {
    if (this.pendingLocalUpdates.size === 0) {
      this.localState = this.clone(this.serverState);
    }
    for (const update of updates) {
      this.localState = this.reducer(this.localState, update.update);
      this.pendingLocalUpdates.set(update.id, update.update);
    }
  }

  applyServerUpdates(updates: { id: string; update: U }[]): void {
    for (const update of updates) {
      this.serverState = this.reducer(this.serverState, update.update);
      this.pendingLocalUpdates.delete(update.id);
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
  deletePending(id: string): void {
    if (this.pendingLocalUpdates.delete(id)) this.rerunPending();
  }

  private rerunPending(): void {
    if (this.pendingLocalUpdates.size === 0) {
      this.localState = this.serverState;
    } else {
      this.localState = this.clone(this.serverState);
      for (const update of this.pendingLocalUpdates.values()) {
        this.localState = this.reducer(this.localState, update);
      }
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
  private readonly stopPromise: Promise<() => Promise<void>>;

  constructor(
    readonly powerSync: AbstractPowerSyncDatabase,
    readonly tableName: string,
    readonly docId: string,
    initialState: S,
    reducer: (state: S, update: U) => S,
    clone: (state: S) => S
  ) {
    this.reconciler = new ServerReconciler(initialState, reducer, clone);

    const psTableName = 'ps_data__${tableName}';
    const docQuery = sanitizeSQL`json_extract(NEW.data, '$.doc_id') = ${docId}`;
    this.stopPromise = powerSync.triggers.trackTableDiff({
      source: psTableName,
      // Required WHEN clause per operation to filter inside the trigger. Use 'TRUE' to track all.
      when: { INSERT: docQuery, UPDATE: docQuery },
      onChange: async (context) => {
        const newUpdates = await context.getAll(`
          SELECT updates.*
          FROM DIFF
          JOIN ${psTableName} updates ON DIFF.id = updates.id
        `);

        // TODO: Handle new updates
        // TODO: Handle updated updates (committed)
        // TODO: Handle deletes (time travel)?

        this.onLoaded?.();
      }
    });
  }

  get state(): S {
    return this.reconciler.state;
  }

  async destroy() {
    const stop = await this.stopPromise;
    await stop();
  }
}

export function useServerReconciliation<S, U>(
  tableName: string,
  docId: string,
  initialState: S,
  reducer: (state: S, update: U) => S,
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
