import { useRef } from 'react';
import { PRESENCE_TABLE, TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildTiptapExtensions } from '@/library/tiptap/extensions';
import { usePowerSync } from '@powersync/react';
import { Box, Button } from '@mui/material';
import MenuBar from './MenuBar';
import { SharedCursorUserInfo, useSharedCursors } from './useSharedCursors';
import { randomName, randomColor } from '@/library/utils';
import { usePowerSyncTextState } from './usePowerSyncTextState';
import './styles.css';

export interface TiptapEditorProps {
  docID: string;
  userID: string;
}

export const TiptapEditor = ({ docID, userID }: TiptapEditorProps) => {
  const powerSync = usePowerSync();

  // Local client info for shared cursors

  const userDataRef = useRef<SharedCursorUserInfo | null>(null);
  if (!userDataRef.current) {
    userDataRef.current = {
      // TODO: Get name from account?
      name: randomName(),
      color: randomColor()
    };
  }

  // PowerSync mutations

  const clear = async () => {
    await powerSync.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE doc_id = ?`, [docID!]);
    await powerSync.execute(`DELETE FROM ${PRESENCE_TABLE} WHERE doc_id = ?`, [docID!]);
  };

  // Tiptap setup

  const editor = useEditor({
    extensions: buildTiptapExtensions(),
    // We update the editor's state each render with a tr, so turn this off
    // to prevent an infinite rerender loop.
    shouldRerenderOnTransaction: false
  });

  usePowerSyncTextState(editor, docID, userID);
  useSharedCursors(editor, docID, userID, userDataRef.current);

  // Render

  return (
    <Box>
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
      <Button onClick={clear}>Clear</Button>
    </Box>
  );
};
