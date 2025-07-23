import { Slice } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { ElementId, IdList } from 'articulated';

export type CollabTiptapStep =
  | {
      /** Insert.
       *
       * Although this derives from the same step (ReplaceStep) as type "replace",
       * we need a special case for the pure-insert case, since insert-after is
       * semantically different than inserting in place of a deleted range.
       */
      type: 'insert';
      beforeId: ElementId | null;
      newId: ElementId;
      slice: object;
    }
  | {
      /**
       * Delete or delete-and-insert.
       */
      type: 'replace';
      /** Deletion range is inclusive. */
      fromId: ElementId;
      /** Omitted if == from (single char deletion). */
      toInclId?: ElementId;
      /** Present if we're also inserting. */
      insert?: {
        // We can insert newId anywhere within the deleted range's exclusive boundary;
        // different choices only affect our sort order relative to chars that are
        // inserted-after one of the deleted ids.
        // In the code below, we insert newId just before fromId.
        newId: ElementId;
        slice: object;
      };
      // TODO: step.structure?
    };

export function collabTiptapStepReducer(
  { tr, idList }: { tr: Transaction; idList: IdList },
  update: CollabTiptapStep[]
): { tr: Transaction; idList: IdList } {
  const schema = tr.doc.type.schema;

  for (const step of update) {
    switch (step.type) {
      case 'insert': {
        const pos = step.beforeId === null ? 0 : idList.indexOf(step.beforeId, 'left') + 1;
        const slice = Slice.fromJSON(schema, step.slice);

        tr.replace(pos, pos, slice);
        idList = idList.insertAfter(step.beforeId, step.newId, slice.size);
        break;
      }
      case 'replace': {
        const from = idList.indexOf(step.fromId, 'right');
        const toIncl = step.toInclId === undefined ? from : idList.indexOf(step.toInclId, 'left');

        const slice = step.insert === undefined ? undefined : Slice.fromJSON(schema, step.insert.slice);

        if (from <= toIncl) {
          // TODO: Use replaceRange instead? Adds some rebasing niceness.
          // Need to ensure idList updates likewise (deletes same range).
          tr.replace(from, toIncl + 1, slice);
          idList = deleteRange(idList, from, toIncl);
          if (step.insert) {
            idList = idList.insertBefore(step.fromId, step.insert.newId, slice!.size);
          }
        } else {
          // This happens if the whole range was already deleted (due to the left/right bias).
          if (step.insert) {
            tr.replace(from, from, slice);
            idList = idList.insertBefore(step.fromId, step.insert.newId, slice!.size);
          }
        }
        break;
      }
      default:
        console.error('Unknown CollabTiptapStep type, skipping:', step);
    }

    if (idList.length !== tr.doc.content.size) {
      console.error('IdList size mismatch (remote)', idList.length, tr.doc.content.size, step);
    }
  }
  return { tr, idList };
}

export function updateToSteps(
  tr: Transaction,
  idList: IdList,
  idGen: ElementIdGenerator
): [steps: CollabTiptapStep[], idList: IdList] {
  // Fast exit for e.g. selection changes.
  if (!tr.docChanged) return [[], idList];

  const collabSteps: CollabTiptapStep[] = [];

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];

    if (step instanceof ReplaceStep) {
      if (step.from < step.to) {
        // Delete or delete-and-insert.
        const fromId = idList.at(step.from);
        const toInclId = step.to === step.from + 1 ? undefined : idList.at(step.to - 1);
        idList = deleteRange(idList, step.from, step.to - 1);
        if (step.slice.size === 0) {
          collabSteps.push({
            type: 'replace',
            fromId,
            toInclId
          });
        } else {
          const newId = idGen.generateAfter(step.from === 0 ? null : idList.at(step.from - 1), idList);
          idList = idList.insertBefore(fromId, newId, step.slice.size);
          collabSteps.push({
            type: 'replace',
            fromId,
            toInclId,
            insert: {
              newId,
              slice: step.slice.toJSON()
            }
          });
        }
      } else {
        // Insert only.
        const beforeId = step.from === 0 ? null : idList.at(step.from - 1);
        const id = idGen.generateAfter(beforeId, idList);
        collabSteps.push({
          type: 'insert',
          beforeId,
          newId: id,
          slice: step.slice.toJSON()
        });
        idList = idList.insertAfter(beforeId, id, step.slice.size);
      }
    }

    const docAfterStep = i === tr.steps.length - 1 ? tr.doc : tr.docs[i + 1];
    if (idList.length !== docAfterStep.content.size) {
      console.error(
        'IdList size mismatch (local)',
        idList.length,
        docAfterStep.content.size,
        step,
        // Document before the step.
        tr.docs[i],
        docAfterStep
      );
    }
  }

  return [collabSteps, idList];
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

// TODO: Add as a method on IdList?
function deleteRange(idList: IdList, startIndex: number, endIndex: number) {
  const allIds: ElementId[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    allIds.push(idList.at(i));
  }
  for (const id of allIds) idList = idList.delete(id);

  return idList;
}
