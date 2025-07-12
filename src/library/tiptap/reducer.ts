import { Transaction } from '@tiptap/pm/state';

export type CollabTiptapStep = {
  type: 'test';
};

export function collabTiptapStepReducer(tr: Transaction, update: CollabTiptapStep): Transaction {
  switch (update.type) {
    case 'test':
      tr.insertText('A', tr.doc.content.size - 1);
      return tr;
    default:
      console.error('Unknown update type, skipping:', update);
      return tr;
  }
}
