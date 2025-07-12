import { useQuery } from '@powersync/react';

/**
 * Returns the result of running the given reducer function over all updates in the the given table,
 * in order: committed updates in server-receipt order, followed by
 * local updates in future-upload order.
 * In other words, it's your local optimistic view of the server's future state.
 *
 * The table must include columns "doc_id" and "update"; the latter is a Text column
 * containing JSON-encoded updates of type U.
 */
export function useReducedTable<S, U>(
  tableName: string,
  docId: string,
  initialState: S,
  reducer: (current: S, update: U, isCommitted: boolean) => S
): S {
  const { data: updateRows } = useQuery<{ update: string; is_committed: number }>(
    `
    SELECT "update", (server_version IS NOT NULL) as is_committed FROM
    (
      SELECT CAST(json_extract(data, '$.doc_id') as TEXT) AS doc_id, CAST(json_extract(data, '$.update') as TEXT) AS "update", CAST(json_extract(data, '$.server_version') as INTEGER) AS server_version, rowid FROM "ps_data__${tableName}"
    )
    WHERE doc_id=?
    ORDER BY server_version NULLS LAST, rowid
  `,
    [docId]
  );

  let state = initialState;
  for (const updateRow of updateRows) {
    const updateObj = JSON.parse(updateRow.update) as U;
    state = reducer(state, updateObj, updateRow.is_committed !== 0);
  }

  return state;
}
