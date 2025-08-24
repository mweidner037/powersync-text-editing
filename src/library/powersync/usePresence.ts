import { usePowerSync, useQuery } from '@powersync/react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** SQLite datetime string. */
  expires_at_local: column.text,
  /** data passed to usePresence's setPresence function. */
  data: column.text,
  /** Positive integer. */
  version: column.integer
} as const;

/**
 * React hook that provides shared presence over a PowerSync table.
 * Use this to show who is present in a shared document and optional info
 * about their state (e.g., mouse or cursor positions).
 *
 * This function will make a best-effort attempt to delete presence rows
 * when unmounted; however, that often fails to upload when a user exits
 * the app or goes offline. You can mitigate this by:
 * 1. Deleting each row from your backend DB 30 seconds after it is inserted (e.g., using a Postgres trigger).
 * 2. Skipping rows satisfying `datetime('now') >= expires_at_local` when uploading to your backend,
 * in case they are from a previous offline session.
 * 3. If possible, deleting all rows for a clientID when that client disconnects from your backend.
 *
 * The `tableName` table's schema must be `PRESENCE_TABLE_SCHEMA`.
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
                VALUES (uuid(), ?, ?, ?, (datetime('now', '+30 seconds')), ?, version)`,
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

    return setWithHeartbeat;
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
    expires_at_local: string;
  }>(
    `
    SELECT client_id, user_id, data, is_remote, expires_at_local
    FROM ${tableName} t1
    WHERE room_id = ? AND client_id != ?
      AND (
        is_remote OR
        (is_remote IS NULL AND datetime('now') < expires_at_local)
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

  // Watched queries don't account for the change in datetime('now').
  // We need to explicitly rerender after the next expires_at_local.
  // TODO: Can we instead get this information (local client disconnection) from the PowerSync service worker?
  // Then we would not need expires_at_local at all.
  let nextLocalExpiration: number | null = null;
  for (const row of presenceRows) {
    if (!row.is_remote) {
      const expiresAtUnix = new Date(row.expires_at_local).valueOf();
      if (nextLocalExpiration === null || expiresAtUnix < nextLocalExpiration) {
        nextLocalExpiration = expiresAtUnix;
      }
    }
  }
  useRerenderAfter(nextLocalExpiration);

  return [setPresenceData, presenceStates];
}

/**
 * Force a rerender just after the given Unix time.
 *
 * Each call (render) overrides the previous call, including canceling the rerender
 * if later called with null.
 */
function useRerenderAfter(timeMs: number | null): void {
  const [counter, setCounter] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (timeoutRef.current !== null) {
    clearTimeout(timeoutRef.current);
  }
  if (timeMs !== null) {
    const renderInMs = Math.max(timeMs - Date.now(), 0) + 1;
    timeoutRef.current = setTimeout(() => setCounter(counter + 1), renderInMs);
  }

  // Don't let setCounter be called after we're unmounted, to prevent warnings.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
}
