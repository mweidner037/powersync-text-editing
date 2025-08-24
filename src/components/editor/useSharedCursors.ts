import { SHARED_CURSORS_TABLE } from '@/library/powersync/AppSchema';
import { getIdListState } from '@/library/tiptap/plugins/id-list-state';
import { SharedCursor } from '@/library/tiptap/plugins/shared-cursors';
import { IdSelection, selectionToIds } from '@/library/tiptap/selection';
import { usePowerSync, useQuery } from '@powersync/react';
import { Editor, EditorEvents } from '@tiptap/react';
import _ from 'lodash';
import { useEffect } from 'react';

export interface SharedUserData {
  name: string;
  color: string;
}

export function useSharedCursors(editor: Editor, docID: string, clientID: string, userData: SharedUserData) {
  const powerSync = usePowerSync();

  // ------------
  // Our shared cursor
  // ------------

  useEffect(() => {
    void powerSync.execute(
      `INSERT INTO ${SHARED_CURSORS_TABLE} (id, doc_id, expires_at, user_data, selection)
      VALUES (?, ?, (datetime('now', '+30 seconds')), ?, ?)`,
      [clientID, docID, JSON.stringify(userData), null]
    );

    return () => {
      // Best-effort delete. If this fails, the row will expire shortly.
      void powerSync.execute(`DELETE FROM ${SHARED_CURSORS_TABLE} WHERE id = ?`, [clientID]);
    };
  }, [editor, docID, clientID, JSON.stringify(userData)]);

  const updatedSharedCursor = _.throttle(async (selection: IdSelection) => {
    await powerSync.execute(
      `UPDATE ${SHARED_CURSORS_TABLE} SET expires_at = (datetime('now', '+30 seconds')), selection = ? WHERE id = ?`,
      [JSON.stringify(selection), clientID]
    );
  }, 500);

  useEffect(() => {
    function onSelectionUpdate({ transaction, editor }: EditorEvents['selectionUpdate']) {
      if (transaction.getMeta('ourRemoteUpdate')) return;

      const { isValid, idList } = getIdListState(editor.state);
      if (!isValid) return;
      const idSelection = selectionToIds(editor.state.selection, idList);

      void updatedSharedCursor(idSelection);

      // TODO: also null/set on focus in/out, like y-cursor.
      // TODO: Hearbeat
    }

    editor.on('selectionUpdate', onSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [editor]);

  // ------------
  // Display shared cursors
  // ------------

  // TODO: Need to rerun this on a timer, not just when data changes (since now() also changes).
  // Could do that always to debounce as well.
  const { data: cursorRows } = useQuery<{ id: string; user_data: string; selection: string | null }>(
    `
    SELECT id, user_data, selection FROM ${SHARED_CURSORS_TABLE}
    WHERE doc_id=?
    AND datetime('now') < expires_at`,
    [docID]
  );
  // TODO: clock sync issues. Currently we're trusting all clients to be in sync.
  // Setting a server expires_at would need a trigger and still won't be in sync with clients.

  const cursors = cursorRows.map(
    ({ id, user_data, selection }): SharedCursor => ({
      clientId: id,
      selection: selection ? JSON.parse(selection) : null,
      user: JSON.parse(user_data)
    })
  );
  editor.commands.setSharedCursors(cursors);
}
