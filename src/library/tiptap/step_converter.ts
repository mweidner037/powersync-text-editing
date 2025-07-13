import { Slice } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { ElementId, IdList } from 'articulated';

export type CollabTiptapStep = {
  type: 'insert';
  beforeId: ElementId | null;
  id: ElementId;
  slice: object;
};

export function collabTiptapStepReducer(
  { tr, idList }: { tr: Transaction; idList: IdList },
  update: CollabTiptapStep[]
): { tr: Transaction; idList: IdList } {
  const schema = tr.doc.type.schema;

  for (const step of update) {
    switch (step.type) {
      case 'insert':
        const pos = step.beforeId === null ? 0 : idList.indexOf(step.beforeId, 'left') + 1;
        const slice = Slice.fromJSON(schema, step.slice);

        tr.replace(pos, pos, slice);
        idList = idList.insertAfter(step.beforeId, step.id, slice.size);
        break;
      default:
        console.error('Unknown step type, skipping:', step);
    }
  }
  return { tr, idList };
}

export function updateToSteps(tr: Transaction, idList: IdList, idGen: ElementIdGenerator): CollabTiptapStep[] {
  console.log('steps', idList.length, tr.doc.content.size);
  const collabSteps: CollabTiptapStep[] = [];

  for (const step of tr.steps) {
    if (step instanceof ReplaceStep) {
      if (step.slice.size > 0) {
        console.log('step', step);
        const beforeId = step.from === 0 ? null : idList.at(step.from);
        const id = idGen.generateAfter(beforeId, idList);
        collabSteps.push({
          type: 'insert',
          beforeId,
          id,
          slice: step.slice.toJSON()
        });
        idList = idList.insertAfter(beforeId, id, step.slice.size);
      }
    }
  }

  // idList is just updated for our internal use when generating steps.
  // We don't return it; instead, collabTiptapStepReducer will compute
  // the same state when reducing over the steps.

  return collabSteps;
}

// TODO: Move to articulated?
export class ElementIdGenerator {
  readonly instanceId: string;
  private nextCounter = 0;

  constructor() {
    this.instanceId = crypto.randomUUID();
  }

  generateAfter(beforeId: ElementId | null, idList: IdList) {
    if (beforeId !== null && beforeId.bunchId.startsWith(this.instanceId)) {
      if (idList.maxCounter(beforeId.bunchId) === beforeId.counter) {
        return { bunchId: beforeId.bunchId, counter: beforeId.counter + 1 };
      }
    }

    const bunchId = `${this.instanceId}_${this.nextCounter++}`;
    return { bunchId, counter: 0 };
  }
}
