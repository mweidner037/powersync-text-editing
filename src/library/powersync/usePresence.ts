import { usePowerSync, useQuery } from '@powersync/react';
import { useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { column } from '@powersync/web';

export interface PresenceState {
  /**
   * A unique ID for this state's client (browser tab / component instance).
   */
  clientID: string;
  /**
   * The userID corresponding to this client.
   */
  userID: string;
  /**
   * The most recent data set by this client.
   *
   * Typically, you will store a JSON string here.
   */
  data: string;
}

/**
 * The PowerSync schema required for a table used by usePresence.
 *
 * See the column descriptions for info that you will need when
 * constructing the backend DB version of this table.
 */
export const PRESENCE_TABLE_SCHEMA = {
  /** UUID. */
  client_id: column.text,
  /** roomID passed to usePresence. */
  room_id: column.text,
  /** userID passed to usePresence. You may authenticate writes based on this column. */
  user_id: column.text,
  /** Must be set to true (1) on the backend DB. Null for optimistic local rows. */
  is_remote: column.integer,
  /** Unix timestamp (seconds). Not meaningful on the server due to clock drift. */
  expires_at_local: column.integer,
  /** data passed to usePresence's setPresence function. Usually, you'll use a JSON string here. */
  data: column.text,
  /** Positive integer. */
  version: column.integer
} as const;

/**
 * React hook that provides shared presence over a PowerSync table.
 * Use this to show who is present in a shared document and optional info
 * about their state (e.g., mouse or cursor positions).
 *
 * The `tableName` table's schema must be `PRESENCE_TABLE_SCHEMA`.
 *
 * This function will make a best-effort attempt to delete presence rows
 * when unmounted; however, that often fails to upload when a user exits
 * the app or goes offline. You can mitigate this by:
 * 1. Deleting all rows for a clientID when that client disconnects from your backend.
 * 2. If that is not possible: Deleting each row from your backend 30 seconds after it is inserted (e.g., using pg_cron).
 * 3. Skipping rows satisfying `Date.now() >= expires_at_local * 1000` when uploading to your backend,
 * in case they are from an old offline session.
 *
 * Returns:
 * - `setPresenceData`: Function to set the current client's presence data.
 * It is recommended to debounce calls to this function for rapid changes like mouse movements.
 * - `presenceState`: The current presence states of all other present clients, in order by clientID.
 *
 * @param roomID An ID for the "room" (e.g., document) where users are sharing presence.
 * @param userID The local user's ID, for exposing to other clients.
 * Note that a user may have multiple clients (e.g. multiple tabs).
 */
export function usePresence(
  tableName: string,
  roomID: string,
  userID: string,
  initialData: string
): [setPresenceData: (data: string) => Promise<void>, presenceStates: PresenceState[]] {
  const powerSync = usePowerSync();

  // ------------
  // Our presence data
  // ------------

  const clientID = useMemo(() => uuidv4(), [tableName, roomID, userID]);
  const versionRef = useRef(0);

  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPresenceData = useMemo(() => {
    const setOnce = async (data: string) => {
      versionRef.current++;
      await powerSync.execute(
        `INSERT INTO ${tableName} (id, client_id, room_id, user_id, expires_at_local, data, version)
                VALUES (uuid(), ?, ?, ?, (unixepoch('now', '+30 seconds')), ?, ?)`,
        [clientID, roomID, userID, data, versionRef.current]
      );
    };

    const setWithHeartbeat = async (data: string) => {
      if (heartbeatTimeoutRef.current !== null) {
        clearTimeout(heartbeatTimeoutRef.current);
      }
      heartbeatTimeoutRef.current = setTimeout(() => setWithHeartbeat(data), 15000);

      await setOnce(data);
    };

    let lastData = initialData;
    const setIfChanged = async (data: string) => {
      // Avoid redundant sets (except for heartbeats).
      if (data === lastData) return;
      lastData = data;
      await setWithHeartbeat(data);
    };

    return setIfChanged;
  }, [clientID]);

  useEffect(
    () => {
      void setPresenceData(initialData);

      return () => {
        // Stop heartbeats.
        if (heartbeatTimeoutRef.current !== null) {
          clearTimeout(heartbeatTimeoutRef.current);
          heartbeatTimeoutRef.current = null;
        }

        // Best-effort delete. See hook docs for how to make it more reliable.
        void powerSync.execute(`DELETE FROM ${tableName} WHERE client_id = ?`, [clientID]);
      };
    },
    // Ignore changes to initialData.
    [clientID]
  );

  // ------------
  // Query other clients' presence
  // ------------

  const { data: presenceRows } = useQuery<{
    client_id: string;
    user_id: string;
    data: string;
    is_remote: number | null;
    expires_at_local: number;
  }>(
    `
    SELECT client_id, user_id, data, is_remote, expires_at_local, version
    FROM ${tableName} t1
    WHERE room_id = ? AND client_id != ?
      AND (
        is_remote OR
        (is_remote IS NULL AND unixepoch('now') < expires_at_local)
      )
      AND version = (
        SELECT MAX(version) 
        FROM ${tableName} t2 
        WHERE t2.client_id = t1.client_id
      )
    ORDER BY client_id`,
    [roomID, clientID]
  );
  const presenceStates = useMemo(
    () =>
      presenceRows.map(
        ({ client_id, user_id, data }): PresenceState => ({
          clientID: client_id,
          userID: user_id,
          data
        })
      ),
    [presenceRows]
  );

  // Note: Technically, we should rerun the above query when any local rows expire.
  // It seems to re-render periodically as-is, perhaps due to our heartbeat retriggering the query.
  // TODO: Can we instead get this information (local client disconnection) from the PowerSync service worker?
  // Then we would not need expires_at_local at all, and it would prevent you
  // from seeing old copies of yourself for 30 seconds after refreshing.

  // TODO: Hide all remote presence rows when offline - we won't get the server's deletes.

  return [setPresenceData, presenceStates];
}
