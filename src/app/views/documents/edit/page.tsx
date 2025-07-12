import { usePowerSync, useQuery } from '@powersync/react';
import { Box, Button, CircularProgress, Typography, styled } from '@mui/material';
import Fab from '@mui/material/Fab';
import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useSupabase } from '@/components/providers/SystemProvider';
import { LISTS_TABLE, TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import './styles.css';
import { useReducedTable } from '@/library/powersync/use_reduced_table';
import { TIPTAP_EXTENSIONS } from '@/library/tiptap/extensions';
import { CollabTiptapStep, collabTiptapStepReducer, updateToSteps } from '@/library/tiptap/step_converter';

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

  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    // We update the editor's state each render with a tr, so turn this off
    // to prevent an infinite rerender loop.
    shouldRerenderOnTransaction: false,
    onUpdate({ transaction }) {
      const steps = updateToSteps(transaction);
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
        {editor ? <EditorController docID={docID!} editor={editor} /> : null}
        <Button onClick={clear}>Clear</Button>
      </Box>
    </NavigationPage>
  );
};

function EditorController({ docID, editor }: { docID: string; editor: Editor }) {
  // Replace the editor's state with that indicated by TEXT_UPDATES_TABLE,
  // preserving the selection (TODO).
  const tr = editor.state.tr;
  tr.delete(0, tr.doc.content.size);
  useReducedTable(TEXT_UPDATES_TABLE, docID, tr, collabTiptapStepReducer);

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
