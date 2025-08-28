import { Mark, Slice } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  DocAttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Step
} from '@tiptap/pm/transform';
import { ElementId, ElementIdGenerator, IdList } from 'articulated';

// TODO: For ReplaceStep, prioritize the current format unless explicitly overridden,
// so that text concurrent to insertion does the expected thing in either insertion order.
// TODO: If an inclusive selection went to the beginning of a paragraph, still do that
// if the paragraph grew concurrently. Both orders (mark then text, text then mark).
// TODO: Version steps? "insert/0" etc. In case we change args or reducers in the future.
// TODO: Alternative to ReplaceAroundStep when you are just changing a block node type
// (e.g. paragraph -> heading), which just does LWW on the block type without creating any
// new ElementIds.

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
      /**
       * Deletion range is inclusive.
       * That way, deletions don't grow to include concurrent insertions at the ends.
       */
      fromId: ElementId;
      /** Omitted if == from (common case optimization for single char deletion). */
      toInclId?: ElementId;
      /** Present if we're also inserting. */
      insert?: {
        /**
         * We can insert newId anywhere within the deleted range's exclusive boundary;
         * different choices only affect our sort order relative to chars that are
         * inserted-after one of the deleted ids.
         * In the code below, we insert newId just before fromId.
         */
        newId: ElementId;
        slice: object;
      };
      // TODO: step.structure?
    }
  | {
      /**
       * ReplaceAroundStep, insertion-only case.
       * E.g. wrapping a block in a bullet list item.
       *
       * Although this derives from the same step (ReplaceAroundStep) as type "replaceAround",
       * we need a special case for the pure-insert case, since insert-before/after is
       * semantically different than inserting in place of a deleted range.
       *
       * In terms of IdList, the step inserts slice[0, insert) after part1BeforeId,
       * and inserts slice[insert, slice.size) before part2AfterId.
       * (We choose to bias towards the outside, since usually this step is wrapping some content in a block).
       */
      type: 'insertAround';
      part1BeforeId: ElementId | null;
      part2AfterId: ElementId | null;
      newId: ElementId;
      slice: object;
      insert: number;
    }
  | {
      /**
       * ReplaceAroundStep, delete or delete-and-insert cases.
       *
       * In terms of IdList, the step replaces the range [from, gapFrom) with slice[0, insert),
       * and replaces the range [gapTo, to) with slice[insert, slice.size).
       */
      type: 'replaceAround';
      /**
       * Deletion range is inclusive.
       * That way, deletions don't grow to include concurrent insertions at the ends.
       */
      fromId: ElementId;
      toInclId: ElementId;
      /**
       * Start for all of the slice's inserted positions.
       * Note that they inserted in two parts, one for each part of the slice.
       * Like in "replace", we can insert each part anywhere within its deleted range's exclusive boundary;
       * we choose to bias towards the outside -
       * just before fromId and just after toInclId.
       */
      newId: ElementId;
      slice: object;
      insert: number;
      /**
       * Gap range is exclusive.
       * That way, the gap grows to include concurrent insertions at the ends
       * (useful in the common case where the gap is a block node's content and
       * this step is changing the block type).
       */
      gapFromIdExcl: ElementId;
      gapToId: ElementId;
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
        idList = idList.insertAfter(step.beforeId, step.newId, slice.size);
        if (!tr.maybeStep(pmStep)) {
          console.log('Rebased insert failed, skipping', step, pmStep);
          // Still insert the ElementIds but mark them as deleted, in case they are
          // referenced in future operations.
          idList = idList.delete(step.newId, slice.size);
        }
        break;
      }
      case 'replace': {
        const from = idList.indexOf(step.fromId, 'right');
        const toIncl = step.toInclId === undefined ? from : idList.indexOf(step.toInclId, 'left');
        const slice = step.insert === undefined ? undefined : Slice.fromJSON(schema, step.insert.slice);

        const pmStep = new ReplaceStep(from, toIncl + 1, slice || Slice.empty);
        if (tr.maybeStep(pmStep)) {
          idList = idList.deleteRange(pmStep.from, pmStep.to);
          if (step.insert) {
            idList = idList.insertBefore(step.fromId, step.insert.newId, slice!.size);
          }
        } else {
          console.log('Rebased replace failed, skipping', step, pmStep);
          if (step.insert) {
            // Still insert the new ElementIds but mark them as deleted, in case they are
            // referenced in future operations.
            idList = idList
              .insertBefore(step.fromId, step.insert.newId, slice!.size)
              .delete(step.insert.newId, slice!.size);
          }
        }
        break;
      }
      case 'insertAround': {
        const from = step.part1BeforeId === null ? 0 : idList.indexOf(step.part1BeforeId, 'left') + 1;
        const to = step.part2AfterId === null ? idList.length : idList.indexOf(step.part2AfterId, 'right');
        const slice = Slice.fromJSON(schema, step.slice);

        const pmStep = new ReplaceAroundStep(from, to, from, to, slice, step.insert);
        // Insert both parts.
        idList = idList.insertAfter(step.part1BeforeId, step.newId, step.insert);
        idList = idList.insertBefore(
          step.part2AfterId,
          { bunchId: step.newId.bunchId, counter: step.newId.counter + step.insert },
          slice.size - step.insert
        );
        if (!tr.maybeStep(pmStep)) {
          console.log('Rebased insertAround failed, skipping', step, pmStep);
          // Still insert the ElementIds but mark them as deleted, in case they are
          // referenced in future operations.
          idList = idList.delete(step.newId, step.insert);
          idList = idList.delete(
            { bunchId: step.newId.bunchId, counter: step.newId.counter + step.insert },
            slice.size - step.insert
          );
        }
        break;
      }
      case 'replaceAround': {
        const from = idList.indexOf(step.fromId, 'right');
        const toIncl = idList.indexOf(step.toInclId, 'left');
        const gapFromExcl = idList.indexOf(step.gapFromIdExcl, 'left');
        const gapTo = idList.indexOf(step.gapToId, 'right');
        const slice = Slice.fromJSON(schema, step.slice);
        // insert doesn't need rebasing because it's defined relative to the slice,
        // which hasn't changed (it's the new content).

        const pmStep = new ReplaceAroundStep(from, toIncl + 1, gapFromExcl + 1, gapTo, slice, step.insert);
        if (tr.maybeStep(pmStep)) {
          // Delete the parts around each gap, then insert the slice's new ElementIds,
          // leaving the gap's ElementIds alone.
          // Do the second part first so we don't need to rebase indices.
          idList = idList.deleteRange(pmStep.gapTo, pmStep.to);
          idList = idList.deleteRange(pmStep.from, pmStep.gapFrom);
          idList = idList.insertBefore(step.fromId, step.newId, step.insert);
          idList = idList.insertAfter(
            step.toInclId,
            { bunchId: step.newId.bunchId, counter: step.newId.counter + step.insert },
            slice.size - step.insert
          );
        } else {
          console.log('Rebased replaceAround failed, skipping', step, pmStep);
          // Still insert the new ElementIds but mark them as deleted, in case they are
          // referenced in future operations.
          idList = idList.insertBefore(step.fromId, step.newId, step.insert).delete(step.newId, step.insert);
          idList = idList
            .insertAfter(
              step.toInclId,
              { bunchId: step.newId.bunchId, counter: step.newId.counter + step.insert },
              slice.size - step.insert
            )
            .delete(
              { bunchId: step.newId.bunchId, counter: step.newId.counter + step.insert },
              slice.size - step.insert
            );
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
          // I believe these steps will always succeed (skipping any nodes that are
          // incompatible with the mark), but we maybeStep just in case.
          if (step.isAdd) tr.maybeStep(new AddMarkStep(from, to, mark));
          else tr.maybeStep(new RemoveMarkStep(from, to, mark));
        }
        break;
      }
      case 'changeNodeMark': {
        const pos = idList.indexOf(step.id);
        if (pos === -1) continue;
        const mark = Mark.fromJSON(schema, step.mark);
        // I'm not sure about AddNodeMark applied to a node that's incompatible with the mark
        // (e.g. because it was true-replaced concurrently). The code doesn't appear to check compatibility,
        // meaning this step will never fail but it also can lead to a schema-violating state.
        // For now we just maybeStep and hope nothing crazy happens.
        if (step.isAdd) tr.maybeStep(new AddNodeMarkStep(pos, mark));
        else tr.maybeStep(new RemoveNodeMarkStep(pos, mark));
        break;
      }
      case 'nodeAttr': {
        const pos = idList.indexOf(step.id);
        if (pos === -1) continue;
        // From looking at the code, I believe this will skip changing the node if step.attr
        // isn't valid for its type (e.g. because it was true-replaced concurrently) - okay.
        tr.maybeStep(new AttrStep(pos, step.attr, step.value));
        break;
      }
      case 'docAttr': {
        const pmStep = Step.fromJSON(schema, step.step);
        tr.maybeStep(pmStep);
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
        idList = idList.deleteRange(step.from, step.to);
        if (step.slice.size === 0) {
          collabSteps.push({
            type: 'replace',
            fromId,
            toInclId
          });
        } else {
          const newId = idGen.generateAfter(step.from === 0 ? null : idList.at(step.from - 1));
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
        const newId = idGen.generateAfter(beforeId);
        collabSteps.push({
          type: 'insert',
          beforeId,
          newId,
          slice: step.slice.toJSON()
        });
        idList = idList.insertAfter(beforeId, newId, step.slice.size);
      }
    } else if (step instanceof ReplaceAroundStep) {
      if (step.from < step.gapFrom || step.gapTo < step.to) {
        const fromId = idList.at(step.from);
        const toInclId = idList.at(step.to - 1);
        const newId = idGen.generateAfter(step.from === 0 ? null : idList.at(step.from - 1));
        const gapFromIdExcl = idList.at(step.gapFrom - 1);
        const gapToId = idList.at(step.gapTo);
        collabSteps.push({
          type: 'replaceAround',
          fromId,
          toInclId,
          newId,
          slice: step.slice.toJSON(),
          insert: step.insert,
          gapFromIdExcl,
          gapToId
        });
        // Delete the parts around each gap, then insert the slice's new ElementIds,
        // leaving the gap's ElementIds alone.
        // Do the second part first so we don't need to rebase indices.
        idList = idList.deleteRange(step.gapTo, step.to);
        idList = idList.deleteRange(step.from, step.gapFrom);
        idList = idList.insertBefore(fromId, newId, step.insert);
        idList = idList.insertAfter(
          toInclId,
          { bunchId: newId.bunchId, counter: newId.counter + step.insert },
          step.slice.size - step.insert
        );
      } else {
        // Insert only.
        const part1BeforeId = step.from === 0 ? null : idList.at(step.from - 1);
        const part2AfterId = step.to === idList.length ? null : idList.at(step.to);
        const newId = idGen.generateAfter(part1BeforeId);
        collabSteps.push({
          type: 'insertAround',
          part1BeforeId,
          part2AfterId,
          newId,
          slice: step.slice.toJSON(),
          insert: step.insert
        });
        // Insert both parts.
        idList = idList.insertAfter(part1BeforeId, newId, step.insert);
        idList = idList.insertBefore(
          part2AfterId,
          { bunchId: newId.bunchId, counter: newId.counter + step.insert },
          step.slice.size - step.insert
        );
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
