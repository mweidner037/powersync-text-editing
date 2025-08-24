import { useRef } from 'react';
import { SHARED_CURSORS_TABLE, TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildTiptapExtensions } from '@/library/tiptap/extensions';
import { usePowerSync } from '@powersync/react';
import { Box, Button } from '@mui/material';
import MenuBar from './MenuBar';
import { SharedUserData, useSharedCursors } from './useSharedCursors';
import { randomName, randomColor } from '@/library/utils';
import { v4 as uuidv4 } from 'uuid';
import { usePowerSyncTextState } from './usePowerSyncTextState';
import './styles.css';

export interface TiptapEditorProps {
  docID: string;
}

export const TiptapEditor = ({ docID }: TiptapEditorProps) => {
  const powerSync = usePowerSync();

  // Local client info for shared cursors

  const clientIDRef = useRef('');
  const userDataRef = useRef<SharedUserData>({ name: '', color: '' });
  if (!clientIDRef.current) {
    // This needs to unique to the editor instance - can't be userId.
    const clientId = uuidv4();
    clientIDRef.current = clientId;
    userDataRef.current = {
      // TODO: Get name from account?
      name: randomName(),
      color: randomColor()
    };
  }

  // PowerSync mutations

  const clear = async () => {
    await powerSync.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE doc_id = ?`, [docID!]);
    await powerSync.execute(`DELETE FROM ${SHARED_CURSORS_TABLE} WHERE doc_id = ?`, [docID!]);
  };

  // Tiptap setup

  const editor = useEditor({
    extensions: buildTiptapExtensions(clientIDRef.current),
    // We update the editor's state each render with a tr, so turn this off
    // to prevent an infinite rerender loop.
    shouldRerenderOnTransaction: false
  });

  usePowerSyncTextState(editor, docID);
  useSharedCursors(editor, docID, clientIDRef.current, userDataRef.current);

  // Render

  return (
    <Box>
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
      <Button onClick={clear}>Clear</Button>
    </Box>
  );
};
