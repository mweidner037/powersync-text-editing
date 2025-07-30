import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';

export const TIPTAP_EXTENSIONS = [
  TextStyleKit,
  StarterKit.configure({
    // TODO: Need a collaborative version of this.
    undoRedo: false,
    trailingNode: false
  })
];
