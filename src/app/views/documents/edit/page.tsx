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
  const idGenRef = useRef<ElementIdGenerator | null>(null);
  if (idGenRef.current === null) {
    idGenRef.current = new ElementIdGenerator();
  }
  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    // We update the editor's state each render with a tr, so turn this off
    // to prevent an infinite rerender loop.
    shouldRerenderOnTransaction: false,
    onUpdate({ transaction }) {
      const steps = updateToSteps(transaction, idListRef.current!, idGenRef.current!);
      void doUpdate(steps);
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
  if (idListRef.current === null) {
    // On first render, initialize idListRef to match the editor's initial state.
    const initialSize = editor.state.doc.content.size;
    idListRef.current = IdList.new().insertAfter(null, { bunchId: 'init', counter: 0 }, initialSize);
  }
  console.log('sel', idListRef.current.length, editor.state.selection);

  // Replace the editor's state with that indicated by TEXT_UPDATES_TABLE,
  // preserving the selection.
  const idSel = selectionToIds(editor.view.state, idListRef.current);
  const tr = editor.state.tr;
  tr.delete(0, tr.doc.content.size);
  // Updates tr in-place.
  const reducedResult = useReducedTable(
    TEXT_UPDATES_TABLE,
    docID,
    { tr, idList: idListRef.current },
    collabTiptapStepReducer
  );
  idListRef.current = reducedResult.idList;
  // Restore selection.
  tr.setSelection(selectionFromIds(idSel, tr.doc, idListRef.current));
  editor.view.updateState(editor.state.apply(tr));
  idListRef.current = reducedResult.idList;

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
