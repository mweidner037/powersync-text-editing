import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { IdListStateExtension } from './plugins/id-list-state';
import { SharedCursorsExtension } from './plugins/shared-cursors';

export function buildTiptapExtensions(clientId: string) {
  return [
    TextStyleKit,
    StarterKit.configure({
      // TODO: Need a collaborative version of this.
      undoRedo: false,
      trailingNode: false
    }),
    IdListStateExtension,
    SharedCursorsExtension.configure({ clientId })
  ];
}
