import { AllSelection, TextSelection, Selection } from '@tiptap/pm/state';
import { Node } from '@tiptap/pm/model';
import { ElementId, IdList } from 'articulated';

export type IdSelection =
  | {
      type: 'all';
    }
  | {
      type: 'cursor';
      /** Left-binding cursor. */
      cursor: ElementId | null;
    }
  | {
      type: 'textRange';
      /** Left-binding cursor. */
      fromCursor: ElementId | null;
      /** Left-binding cursor. */
      toCursor: ElementId | null;
      forwards: boolean;
    }
  | { type: 'unsupported' };

export function selectionToIds(selection: Selection, idList: IdList): IdSelection {
  if (selection instanceof AllSelection) {
    return { type: 'all' };
  } else if (selection.to === selection.from) {
    return { type: 'cursor', cursor: idList.cursorAt(selection.from) };
  } else if (selection instanceof TextSelection) {
    const { from, to, anchor, head } = selection;
    return {
      type: 'textRange',
      fromCursor: idList.cursorAt(from),
      toCursor: idList.cursorAt(to),
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
      const pos = idList.cursorIndex(idSel.cursor);
      return Selection.near(doc.resolve(pos));
    case 'textRange':
      const from = idList.cursorIndex(idSel.fromCursor);
      const to = idList.cursorIndex(idSel.toCursor);
      if (to <= from) return Selection.near(doc.resolve(from));
      const [anchor, head] = idSel.forwards ? [from, to] : [to, from];
      return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    case 'unsupported':
      // Set cursor to the end.
      return Selection.atEnd(doc);
  }
}
