import { AllSelection, TextSelection, Selection } from '@tiptap/pm/state';
import { Node } from '@tiptap/pm/model';
import { ElementId, IdList } from 'articulated';

export type IdSelection =
  | {
      type: 'all';
    }
  | {
      type: 'cursor';
      /** The character to the left of the cursor, or null if at the beginning. */
      id: ElementId | null;
    }
  | {
      type: 'textRange';
      /** The character to the right of the selection start. */
      start: ElementId;
      /** The character to the left of the selection end. */
      end: ElementId;
      forwards: boolean;
    }
  | { type: 'unsupported' };

export function selectionToIds(selection: Selection, idList: IdList): IdSelection {
  if (selection instanceof AllSelection) {
    return { type: 'all' };
  } else if (selection.to === selection.from) {
    console.log('->', selection.from, idList.length);
    return { type: 'cursor', id: selection.from === 0 ? null : idList.at(selection.from - 1) };
  } else if (selection instanceof TextSelection) {
    const { from, to, anchor, head } = selection;
    return {
      type: 'textRange',
      start: idList.at(from),
      end: idList.at(to - 1),
      forwards: head > anchor
    };
  } else {
    console.error('Unsupported selection:', selection);
    return { type: 'unsupported' };
  }
}

export function selectionFromIds(idSel: IdSelection, doc: Node, idList: IdList): Selection {
  switch (idSel.type) {
    case 'all':
      return new AllSelection(doc);
    case 'cursor':
      const pos = idSel.id === null ? 0 : idList.indexOf(idSel.id, 'left') + 1;
      console.log('<-', pos, idList.length);
      return Selection.near(doc.resolve(pos));
    case 'textRange':
      const from = idList.indexOf(idSel.start, 'right');
      const to = idList.indexOf(idSel.end, 'left') + 1;
      if (to <= from) return Selection.near(doc.resolve(from));
      const [anchor, head] = idSel.forwards ? [from, to] : [to, from];
      return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    case 'unsupported':
      // Set cursor to the first char.
      return Selection.atStart(doc);
  }
}
