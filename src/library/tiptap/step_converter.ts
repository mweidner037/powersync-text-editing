import { Mark, Slice } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  DocAttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceStep,
  Step
} from '@tiptap/pm/transform';
import { ElementId, IdList } from 'articulated';

// TODO: can/maybe checks, especially for replace/aroundstep. If failed, still add deleted IDs to IdList.
// TODO: For replace/around, use raw steps instead of tr. methods, so that they are not doing extra work that
// will mess up our IdList values.
// For other steps, I guess it is okay to let PM patch things up, but still avoid errors from e.g. invalid node types?
// Compare step.apply to closest Transaction method.
// TODO: For ReplaceStep, prioritize the current format unless explicitly overridden,
// so that text concurrent to insertion does the expected thing in either insertion order.
// TODO: If an inclusive selection went to the beginning of a paragraph, still do that
// if the paragraph grew concurrently. Both orders (mark then text, text then mark).

export type CollabTiptapStep =
  | {
      /** ReplaceStep, insertion-only case.
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
       * ReplaceStep, delete or delete-and-insert cases.
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
    }
  | {
      /** AddMarkStep or RemoveMarkStep. */
      type: 'changeMark';
      /** Inclusive. */
      fromId: ElementId;
      /** If the mark is inclusive, this is the exclusive end of the range, else the inclusive end. */
      toId: ElementId | null;
      mark: object;
      isAdd: boolean;
    }
  | {
      /** AddNodeMarkStep or RemoveNodeMarkStep. */
      type: 'changeNodeMark';
      id: ElementId;
      mark: object;
      isAdd: boolean;
    }
  | {
      /** AttrStep. */
      type: 'nodeAttr';
      id: ElementId;
      attr: string;
      value: unknown;
    }
  | {
      /** DocAttrStep. */
      type: 'docAttr';
      step: object;
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

        const pmStep = new ReplaceStep(pos, pos, slice);
        if (tr.maybeStep(pmStep)) {
          idList = idList.insertAfter(step.beforeId, step.newId, slice.size);
        } else {
          console.log('Rebased insert failed, skipping');
        }
        break;
      }
      case 'replace': {
        const from = idList.indexOf(step.fromId, 'right');
        const toIncl = step.toInclId === undefined ? from : idList.indexOf(step.toInclId, 'left');

        const slice = step.insert === undefined ? undefined : Slice.fromJSON(schema, step.insert.slice);

        if (from <= toIncl) {
          const pmStep = new ReplaceStep(from, toIncl + 1, slice || Slice.empty);
          if (tr.maybeStep(pmStep)) {
            idList = deleteRange(idList, from, toIncl);
            if (step.insert) {
              idList = idList.insertBefore(step.fromId, step.insert.newId, slice!.size);
            }
          } else {
            console.log('Rebased replace failed, skipping');
          }
        } else {
          // This happens if the whole range was already deleted (due to the left/right bias).
          if (step.insert) {
            const pmStep = new ReplaceStep(from, from, slice!);
            if (tr.maybeStep(pmStep)) {
              idList = idList.insertBefore(step.fromId, step.insert.newId, slice!.size);
            } else {
              console.log('Rebased replace(2) failed, skipping');
            }
          }
        }
        break;
      }
      case 'changeMark': {
        const mark = Mark.fromJSON(schema, step.mark);
        const inclusive = mark.type.spec.inclusive ?? true;
        const from = idList.indexOf(step.fromId, 'right');
        const to = inclusive
          ? step.toId === null
            ? tr.doc.content.size
            : idList.indexOf(step.toId, 'right')
          : idList.indexOf(step.toId!, 'left') + 1;
        if (from < to) {
          if (step.isAdd) tr.addMark(from, to, mark);
          else tr.removeMark(from, to, mark);
        }
        break;
      }
      case 'changeNodeMark': {
        const pos = idList.indexOf(step.id);
        if (pos === -1) continue;
        // None of our mutations change the node at an ElementId, so pos should contain
        // "the same" node that was targeted originally.
        // TODO: This could change if we implement ReplaceAroundStep in a certain way.
        const mark = Mark.fromJSON(schema, step.mark);
        if (step.isAdd) tr.addNodeMark(pos, mark);
        else tr.removeNodeMark(pos, mark);
        break;
      }
      case 'nodeAttr': {
        const pos = idList.indexOf(step.id);
        if (pos === -1) continue;
        // None of our mutations change the node at an ElementId, so pos should contain
        // "the same" node that was targeted originally.
        tr.setNodeAttribute(pos, step.attr, step.value);
        break;
      }
      case 'docAttr': {
        const pmStep = Step.fromJSON(schema, step.step);
        tr.step(pmStep);
        break;
      }
      default:
        console.error('Unknown CollabTiptapStep type, skipping:', step satisfies never);
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
    const docBeforeStep = tr.docs[i];
    const docAfterStep = i === tr.steps.length - 1 ? tr.doc : tr.docs[i + 1];

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
    } else if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const isAdd = step instanceof AddMarkStep;
      const inclusive = step.mark.type.spec.inclusive ?? true;
      const fromId = idList.at(step.from);
      const toId = inclusive
        ? step.to === docBeforeStep.content.size - 1
          ? null
          : idList.at(step.to + 1)
        : idList.at(step.to);
      collabSteps.push({
        type: 'changeMark',
        fromId,
        toId,
        mark: step.mark.toJSON(),
        isAdd
      });
    } else if (step instanceof AddNodeMarkStep || step instanceof RemoveNodeMarkStep) {
      const isAdd = step instanceof AddNodeMarkStep;
      const id = idList.at(step.pos);
      collabSteps.push({
        type: 'changeNodeMark',
        id,
        mark: step.mark.toJSON(),
        isAdd
      });
    } else if (step instanceof AttrStep) {
      const id = idList.at(step.pos);
      collabSteps.push({
        type: 'nodeAttr',
        id,
        attr: step.attr,
        value: step.value
      });
    } else if (step instanceof DocAttrStep) {
      collabSteps.push({
        type: 'docAttr',
        step: step.toJSON()
      });
    } else {
      console.error('Unknown ProseMirror step type, skipping:', step);
    }

    if (idList.length !== docAfterStep.content.size) {
      console.error(
        'IdList size mismatch (local)',
        idList.length,
        docAfterStep.content.size,
        step,
        docBeforeStep,
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
