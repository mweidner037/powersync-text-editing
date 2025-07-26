import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';

export const TIPTAP_EXTENSIONS = [
  TextStyleKit,
  StarterKit.configure({
    // TODO: Need a collaborative version of this.
    undoRedo: false,
    trailingNode: false,
    // TODO: Enable once we have ReplaceAroundStep.
    heading: false,
    blockquote: false,
    codeBlock: false,
    listItem: false,
    bulletList: false,
    orderedList: false,
    listKeymap: false
  })
];
