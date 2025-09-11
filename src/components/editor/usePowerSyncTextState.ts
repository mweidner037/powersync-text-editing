import { TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { CollabTiptapStep, applyCollabSteps, updateToSteps } from '@/library/tiptap/step_converter';
import { usePowerSync } from '@powersync/react';
import { Editor, EditorEvents } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { getIdListState, setIdListState } from '@/library/tiptap/plugins/id-list-state';
import { selectionToIds, selectionFromIds } from '@/library/tiptap/selection';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { ElementIdGenerator, IdList } from 'articulated';
import { useServerReconciliation } from '@/library/powersync/server_reconciliation';
import { Slice } from '@tiptap/pm/model';
import { v4 as uuidv4 } from 'uuid';

function reducer(state: EditorState, updates: CollabTiptapStep[][]): EditorState {
  const tr = state.tr;
  let idList = getIdListState(state).idList;
  for (const update of updates) {
    idList = applyCollabSteps(tr, idList, update);
  }
  setIdListState(tr, idList);

  return state.apply(tr);
}

export function usePowerSyncTextState(editor: Editor, docID: string, userID: string) {
  const powerSync = usePowerSync();

  // ------------
  // Our updates
  // ------------

  const lastUpdateIdRef = useRef<string | null>(null);

  const doUpdate = async (update: CollabTiptapStep[]) => {
    const id = uuidv4();
    lastUpdateIdRef.current = id;
    await powerSync.execute(
      `INSERT INTO
                ${TEXT_UPDATES_TABLE}
                    (id, created_at, created_by, "update", doc_id)
                VALUES
                    (?, datetime(), ?, ?, ?)`,
      [id, userID, JSON.stringify(update), docID!]
    );
  };

  const idGenRef = useRef<ElementIdGenerator>(new ElementIdGenerator(() => crypto.randomUUID()));

  useEffect(() => {
    function onUpdate({ transaction, editor }: EditorEvents['update']) {
      const [steps, newIdList] = updateToSteps(transaction, getIdListState(editor.state).idList, idGenRef.current);
      // It would be cleaner to add the new IdList to transaction and then dispatch it,
      // like when using ProseMirror's dispatchTransaction prop.
      // That way the state is updated before any local plugins see this transaction.
      // With Tiptap, we instead need to update it afterwards and trust plugins to respect isValid.
      editor.commands.setIdListState(newIdList);

      if (steps.length > 0) void doUpdate(steps);
    }

    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor]);

  // ------------
  // Display remote updates
  // ------------

  // On each render, set the editor's state to that indicated by TEXT_UPDATES_TABLE.
  // Except, preserve the selection in a collaboration-aware way using IdList.

  const initialState = useMemo(() => {
    const tr = editor.state.tr;
    tr.delete(0, tr.doc.content.size);
    const initialSize = tr.doc.content.size;
    const initialIdList = IdList.new().insertAfter(null, { bunchId: 'init', counter: 0 }, initialSize);
    setIdListState(tr, initialIdList);

    return editor.state.apply(tr);
  }, [editor]);

  const oldReconciliationStateRef = useRef<EditorState | null>(null);
  const {
    state: reconciliationState,
    isLoading,
    localIds,
    serverIds
  } = useServerReconciliation(
    TEXT_UPDATES_TABLE,
    docID,
    initialState,
    reducer,
    // ProseMirror states are immutable, so we don't need to deep copy.
    (state) => state
  );

  if (
    !isLoading &&
    reconciliationState !== oldReconciliationStateRef.current &&
    // We need to wait until PowerSync's state includes the editor's latest local update.
    // Otherwise the editor's state goes backwards and our restore-selection logic gets confused.
    (lastUpdateIdRef.current === null ||
      localIds.has(lastUpdateIdRef.current) ||
      serverIds.has(lastUpdateIdRef.current))
  ) {
    oldReconciliationStateRef.current = reconciliationState;

    // Preserve the selection in a collaboration-aware way.
    // We do this by converting the initial selection to ElementIds and back.
    const idSelection = selectionToIds(editor.state.selection, getIdListState(editor.state).idList);

    // We need to update using a tr derived from editor.state - we can't just set
    // reconciliationState directly. Do this by rewriting all content in a tr, like y-prosemirror.
    // TODO: Make a minimal tr based on a diff instead, to help with https://github.com/yjs/y-prosemirror/issues/49
    const newIdList = getIdListState(reconciliationState).idList;
    const tr = editor.state.tr;
    tr.replace(0, tr.doc.content.size, new Slice(reconciliationState.doc.content, 0, 0));
    setIdListState(tr, newIdList);
    try {
      tr.setSelection(selectionFromIds(idSelection, tr.doc, newIdList));
    } catch (error) {
      // This can happen if the state goes backwards somehow. Clear the selection and don't crash.
      tr.setSelection(TextSelection.create(tr.doc, 0));
      console.error('Error restoring selection', error);
    }
    tr.setMeta('ourRemoteUpdate', true);

    editor.view.updateState(editor.state.apply(tr));
  }
}
