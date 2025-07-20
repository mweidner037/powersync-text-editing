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

const DocumentEditSection = () => {
  // PowerSync queries

  const powerSync = usePowerSync();
  const supabase = useSupabase();
  const { id: docID } = useParams();

  const {
    data: [listRecord]
  } = useQuery<{ name: string }>(`SELECT name FROM ${LISTS_TABLE} WHERE id = ?`, [docID]);

  // PowerSync mutations

  const doUpdate = async (update: CollabTiptapStep[]) => {
    const userID = supabase?.currentSession?.user.id;
    if (!userID) {
      throw new Error(`Could not get user ID.`);
    }

    await powerSync.execute(
      `INSERT INTO
                ${TEXT_UPDATES_TABLE}
                    (id, created_at, created_by, "update", doc_id)
                VALUES
                    (uuid(), datetime(), ?, ?, ?)`,
      [userID, JSON.stringify(update), docID!]
    );
  };
  const clear = async () => {
    await powerSync.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE doc_id = ?`, [docID!]);
  };

  // Tiptap setup

  const idListRef = useRef<IdList | null>(null);
  const idGenRef = useRef<ElementIdGenerator>(new ElementIdGenerator());
  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    // We update the editor's state each render with a tr, so turn this off
    // to prevent an infinite rerender loop.
    shouldRerenderOnTransaction: false,
    onUpdate({ transaction }) {
      const [steps, newIdList] = updateToSteps(transaction, idListRef.current!, idGenRef.current);
      // We need to set this now so that it matches the editor's state (which functions like a ref).
      // That's needed for selectionToIds to work in the next render.
      idListRef.current = newIdList;

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
        <EditorContent editor={editor} />
        {editor ? <EditorController key={docID} docID={docID!} editor={editor} idListRef={idListRef} /> : null}
        <Button onClick={clear}>Clear</Button>
      </Box>
    </NavigationPage>
  );
};

function EditorController({
  docID,
  editor,
  idListRef
}: {
  docID: string;
  editor: Editor;
  idListRef: MutableRefObject<IdList | null>;
}) {
  // On each render, set the editor's state to that indicated by TEXT_UPDATES_TABLE,
  // and update idListRef to match.
  // Except, preserve the selection in a collaboration-aware way using IdList.

  // - Store the current selection in terms of IdList ids.
  // Except, skip on the first render (when idListRef is null), to prevent errors.
  const idSel = idListRef.current ? selectionToIds(editor.view.state, idListRef.current) : null;

  // - Reset the state, since we (re-)apply all updates below.
  const tr = editor.state.tr;
  tr.delete(0, tr.doc.content.size);
  const initialSize = tr.doc.content.size;
  idListRef.current = IdList.new().insertAfter(null, { bunchId: 'init', counter: 0 }, initialSize);

  // - Apply all updates to tr and idListRef.
  const reducedResult = useReducedTable(
    TEXT_UPDATES_TABLE,
    docID,
    { tr, idList: idListRef.current },
    collabTiptapStepReducer
  );
  idListRef.current = reducedResult.idList;

  // - Restore the current selection.
  if (idSel) {
    tr.setSelection(selectionFromIds(idSel, tr.doc, idListRef.current));
  }

  // - Update the editor. idListRef has already been updated.
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
