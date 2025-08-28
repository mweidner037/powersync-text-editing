import { useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildTiptapExtensions } from '@/library/tiptap/extensions';
import { Box } from '@mui/material';
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
  // Local client info for shared cursors

  const userDataRef = useRef<SharedCursorUserInfo | null>(null);
  if (!userDataRef.current) {
    userDataRef.current = {
      name: randomName(),
      color: randomColor()
    };
  }

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
    </Box>
  );
};
