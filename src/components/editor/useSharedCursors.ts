import { PRESENCE_TABLE } from '@/library/powersync/AppSchema';
import { usePresence } from '@/library/powersync/usePresence';
import { getIdListState } from '@/library/tiptap/plugins/id-list-state';
import { SharedCursor } from '@/library/tiptap/plugins/shared-cursors';
import { IdSelection, selectionToIds } from '@/library/tiptap/selection';
import { Editor, EditorEvents } from '@tiptap/react';
import _ from 'lodash';
import { useEffect, useMemo } from 'react';

export interface SharedCursorUserInfo {
  name: string;
  color: string;
}

/** The data obj for usePresence. */
interface PresenceData {
  userInfo: SharedCursorUserInfo;
  selection: IdSelection | null;
}

export function useSharedCursors(editor: Editor, docID: string, userID: string, userInfo: SharedCursorUserInfo) {
  const [setPresenceData, presenceStates] = usePresence(
    PRESENCE_TABLE,
    docID,
    userID,
    JSON.stringify({
      userInfo,
      selection: null
    } satisfies PresenceData)
  );

  // ------------
  // Our shared cursor
  // ------------

  const updatedSharedCursor = useMemo(
    () =>
      _.throttle((selection: IdSelection) => {
        setPresenceData(
          JSON.stringify({
            userInfo,
            selection
          } satisfies PresenceData)
        );
      }, 500),
    [setPresenceData, userInfo]
  );

  useEffect(() => {
    function onSelectionUpdate({ transaction, editor }: EditorEvents['selectionUpdate']) {
      if (transaction.getMeta('ourRemoteUpdate')) return;

      const { isValid, idList } = getIdListState(editor.state);
      if (!isValid) return;
      const idSelection = selectionToIds(editor.state.selection, idList);

      void updatedSharedCursor(idSelection);

      // TODO: also null/set on focus in/out, like y-cursor.
    }

    editor.on('selectionUpdate', onSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [editor]);

  // ------------
  // Display shared cursors
  // ------------

  const cursors = presenceStates.map((state): SharedCursor => {
    const data = JSON.parse(state.data) as PresenceData;
    return {
      clientId: state.clientID,
      selection: data.selection,
      user: data.userInfo
    };
  });
  editor.commands.setSharedCursors(cursors);
}
