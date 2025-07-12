import { Slice } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';

export type CollabTiptapStep = {
  type: 'insert';
  pos: number;
  slice: object;
};

export function collabTiptapStepReducer(tr: Transaction, update: CollabTiptapStep[]): Transaction {
  const schema = tr.doc.type.schema;

  for (const step of update) {
    switch (step.type) {
      case 'insert':
        const slice = Slice.fromJSON(schema, step.slice);
        tr.replace(step.pos, step.pos, slice);
        break;
      default:
        console.error('Unknown step type, skipping:', step);
    }
  }
  return tr;
}

export function updateToSteps(tr: Transaction): CollabTiptapStep[] {
  const collabSteps: CollabTiptapStep[] = [];

  for (const step of tr.steps) {
    if (step instanceof ReplaceStep) {
      if (step.slice.size > 0) {
        collabSteps.push({
          type: 'insert',
          pos: step.from,
          slice: step.slice.toJSON()
        });
      }
    }
  }

  return collabSteps;
}
