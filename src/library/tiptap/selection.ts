import { EditorState, AllSelection, TextSelection, Selection } from '@tiptap/pm/state';
import { Node } from '@tiptap/pm/model';
import { ElementId, IdList } from 'articulated';

export type IdSelection =
  | {
      type: 'all';
    }
  | { type: 'cursor'; id: ElementId }
  | { type: 'textRange'; start: ElementId; end: ElementId; forwards: boolean }
  | { type: 'unsupported' };

export function selectionToIds(state: EditorState, idList: IdList): IdSelection {
  if (state.selection instanceof AllSelection) {
    return { type: 'all' };
  } else if (state.selection.to === state.selection.from) {
    return { type: 'cursor', id: idList.at(state.selection.from) };
  } else if (state.selection instanceof TextSelection) {
    const { from, to, anchor, head } = state.selection;
    return {
      type: 'textRange',
      start: idList.at(from),
      end: idList.at(to - 1),
      forwards: head > anchor
    };
  } else {
    console.error('Unsupported selection:', state.selection);
    return { type: 'unsupported' };
  }
}

export function selectionFromIds(idSel: IdSelection, doc: Node, idList: IdList): Selection {
  switch (idSel.type) {
    case 'all':
      return new AllSelection(doc);
    case 'cursor':
      let pos = idList.indexOf(idSel.id, 'left');
      if (pos < 0) pos = 0;
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
