import { TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { CollabTiptapStep, collabTiptapStepReducer, updateToSteps } from '@/library/tiptap/step_converter';
import { usePowerSync } from '@powersync/react';
import { Editor, EditorEvents } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import { getIdListState, setIdListState } from '@/library/tiptap/plugins/id-list-state';
import { useReducedTable } from '@/library/powersync/useReducedTable';
import { selectionToIds, selectionFromIds } from '@/library/tiptap/selection';
import { TextSelection } from '@tiptap/pm/state';
import { ElementIdGenerator, IdList } from 'articulated';

export function usePowerSyncTextState(editor: Editor, docID: string, userID: string) {
  const powerSync = usePowerSync();

  // ------------
  // Our updates
  // ------------

  const pendingUpdateCounterRef = useRef(0);

  const doUpdate = async (update: CollabTiptapStep[]) => {
    pendingUpdateCounterRef.current++;
    try {
      await powerSync.execute(
        `INSERT INTO
                ${TEXT_UPDATES_TABLE}
                    (id, created_at, created_by, "update", doc_id)
                VALUES
                    (uuid(), datetime(), ?, ?, ?)`,
        [userID, JSON.stringify(update), docID!]
      );
    } finally {
      pendingUpdateCounterRef.current--;
    }
  };

  const idGenRef = useRef<ElementIdGenerator>(new ElementIdGenerator(() => crypto.randomUUID()));

  useEffect(() => {
    function onUpdate({ transaction, editor }: EditorEvents['update']) {
      const [steps, newIdList] = updateToSteps(transaction, getIdListState(editor.state).idList, idGenRef.current);
      if (steps.length > 0) void doUpdate(steps);

      // It would be cleaner to add the new IdList to transaction and then dispatch it,
      // like when using ProseMirror's dispatchTransaction prop.
      // That way the state is updated before any local plugins see this transaction.
      // With Tiptap, we instead need to update it afterwards and trust plugins to respect isValid.
      editor.commands.setIdListState(newIdList);
    }

    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor]);

  // ------------
  // Display remote updates
  // ------------

  // On each render, set the editor's state to that indicated by TEXT_UPDATES_TABLE,
  // and update idListRef to match.
  // Except, preserve the selection in a collaboration-aware way using IdList.

  const startingIdList = getIdListState(editor.state).idList;

  // - Reset the state, since we (re-)apply all updates below.
  const tr = editor.state.tr;
  tr.delete(0, tr.doc.content.size);
  const initialSize = tr.doc.content.size;
  const initialIdList = IdList.new().insertAfter(null, { bunchId: 'init', counter: 0 }, initialSize);

  // - Apply all updates to tr and idListRef.
  const { data: reducedResult, isFetching } = useReducedTable(
    TEXT_UPDATES_TABLE,
    docID,
    { tr, idList: initialIdList },
    collabTiptapStepReducer
  );

  if (isFetching || pendingUpdateCounterRef.current > 0) {
    // After performing a local update, we need to wait for the reduced state to be at least
    // as up-to-date before touching the editor.
    // Otherwise, the editor's state goes backwards, potentially causing jitter
    // and also confusing our restore-selection code.
    // Empirically, the reduced state is updated once:
    // - All of the pending powerSync.execute promises have resolved, and
    // - isFetching is false.
    return null;
  }

  setIdListState(tr, reducedResult.idList);

  // - Restore the starting selection in a collaboration-aware way.
  // We do this by converting the initial selection to ElementIds and back.
  const startingSelection = editor.state.selection;
  const idSelection = selectionToIds(startingSelection, startingIdList);
  try {
    tr.setSelection(selectionFromIds(idSelection, tr.doc, reducedResult.idList));
  } catch (error) {
    // This can happen naturally if the state goes backwards somehow. Clear the selection and don't crash.
    tr.setSelection(TextSelection.create(tr.doc, 0));
    console.error('Error restoring selection', error);
  }

  // - Update the editor.
  tr.setMeta('ourRemoteUpdate', true);
  editor.view.updateState(editor.state.apply(tr));
}
