import { usePowerSync, useQuery } from '@powersync/react';
import { Box, Button, CircularProgress, Typography, styled } from '@mui/material';
import Fab from '@mui/material/Fab';
import { MutableRefObject, Suspense, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSupabase } from '@/components/providers/SystemProvider';
import { LISTS_TABLE, TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import './styles.css';
import { useReducedTable } from '@/library/powersync/use_reduced_table';
import { TIPTAP_EXTENSIONS } from '@/library/tiptap/extensions';
import {
  CollabTiptapStep,
  collabTiptapStepReducer,
  ElementIdGenerator,
  updateToSteps
} from '@/library/tiptap/step_converter';
import { IdList } from 'articulated';
import { selectionFromIds, selectionToIds } from '@/library/tiptap/selection';
import { TextSelection } from '@tiptap/pm/state';
import MenuBar from './MenuBar';
import { getIdListState, setIdListState } from '@/library/tiptap/plugins/id-list-state';

const DocumentEditSection = () => {
  // PowerSync queries

  const powerSync = usePowerSync();
  const supabase = useSupabase();
  const { id: docID } = useParams();

  const {
    data: [listRecord]
  } = useQuery<{ name: string }>(`SELECT name FROM ${LISTS_TABLE} WHERE id = ?`, [docID]);

  // PowerSync mutations

  const pendingUpdateCounterRef = useRef(0);

  const doUpdate = async (update: CollabTiptapStep[]) => {
    const userID = supabase?.currentSession?.user.id;
    if (!userID) {
      throw new Error(`Could not get user ID.`);
    }

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
  const clear = async () => {
    await powerSync.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE doc_id = ?`, [docID!]);
  };

  // Tiptap setup

  const idGenRef = useRef<ElementIdGenerator>(new ElementIdGenerator());
  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    // We update the editor's state each render with a tr, so turn this off
    // to prevent an infinite rerender loop.
    shouldRerenderOnTransaction: false,
    onUpdate({ transaction, editor }) {
      const [steps, newIdList] = updateToSteps(transaction, getIdListState(editor.state).idList, idGenRef.current);
      // It would be cleaner to add the new IdList to transaction and then dispatch it,
      // like when using ProseMirror's dispatchTransaction prop.
      // That way the state is updated before any local plugins see this transaction.
      // With Tiptap, we instead need to update it afterwards and trust plugins to not
      // read the state on local updates.
      editor.commands.setIdListState(newIdList);

      if (steps.length > 0) void doUpdate(steps);
    }
  });

  // Render

  if (!listRecord) {
    return (
      <Box>
        <Typography>No matching document found, please navigate back...</Typography>
      </Box>
    );
  }

  return (
    <NavigationPage title={`Document: ${listRecord.name}`}>
      <Box>
        <MenuBar editor={editor} />
        <EditorContent editor={editor} />
        {editor ? (
          <EditorController
            key={docID}
            docID={docID!}
            editor={editor}
            pendingUpdateCounterRef={pendingUpdateCounterRef}
          />
        ) : null}
        <Button onClick={clear}>Clear</Button>
      </Box>
    </NavigationPage>
  );
};

function EditorController({
  docID,
  editor,
  pendingUpdateCounterRef
}: {
  docID: string;
  editor: Editor;
  pendingUpdateCounterRef: MutableRefObject<number>;
}) {
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
  editor.view.updateState(editor.state.apply(tr));

  // Not a real component, just a wrapper for hooks.
  return null;
}

export default function DocumentEditPage() {
  return (
    <Box>
      <Suspense fallback={<CircularProgress />}>
        <DocumentEditSection />
      </Suspense>
    </Box>
  );
}

namespace S {
  export const FloatingActionButton = styled(Fab)`
    position: absolute;
    bottom: 20px;
    right: 20px;
  `;
}
