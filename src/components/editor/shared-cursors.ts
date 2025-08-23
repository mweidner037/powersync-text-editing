import { SHARED_CURSORS_TABLE } from '@/library/powersync/AppSchema';
import { getIdListState } from '@/library/tiptap/plugins/id-list-state';
import { IdSelection, selectionToIds } from '@/library/tiptap/selection';
import { usePowerSync } from '@powersync/react';
import { Editor, EditorEvents } from '@tiptap/react';
import _ from 'lodash';
import { useEffect } from 'react';

export interface SharedUserData {
  name: string;
  color: string;
}

export function useSharedCursors(editor: Editor, docID: string, clientID: string, userData: SharedUserData) {
  const powerSync = usePowerSync();

  // Our shared cursor

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
}
