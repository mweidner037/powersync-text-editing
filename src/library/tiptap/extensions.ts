import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { IdListStateExtension } from './plugins/id-list-state';
import { SharedCursorsExtension } from './plugins/shared-cursors';

export function buildTiptapExtensions() {
  return [
    TextStyleKit,
    StarterKit.configure({
      undoRedo: false,
      trailingNode: false
    }),
    IdListStateExtension,
    SharedCursorsExtension
  ];
}
