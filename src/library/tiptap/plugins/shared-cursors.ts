import { EditorState, Plugin, PluginKey, StateField } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { IdSelection, selectionFromIds } from '../selection';
import { Decoration, DecorationAttrs, DecorationSet } from '@tiptap/pm/view';
import { getIdListState } from './id-list-state';
import { IdList } from 'articulated';

// Modified from y-prosemirror's cursor plugin by Kevin Jahns
// (https://github.com/yjs/y-prosemirror/blob/master/src/plugins/cursor-plugin.js)
// and Tiptap's extension-collaboration-caret
// (https://github.com/ueberdosis/tiptap/blob/main/packages/extension-collaboration-caret/src/collaboration-caret.ts),
// both of which are MIT licensed.

const pluginKey = new PluginKey('sharedCursors');

export interface SharedCursor {
  clientId: string;
  selection: IdSelection | null;
  /**
   * The user details object – feel free to add properties to this object as needed
   * @example { name: 'John Doe', color: '#305500' }
   */
  user: Record<string, any>;
}

interface PluginStateType {
  cursors: SharedCursor[];
  decorations: DecorationSet;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    setSharedCursors: {
      setSharedCursors: (cursors: SharedCursor[]) => ReturnType;
    };
  }
}

/**
 * Extension that renders shared cursors.
 *
 * You are responsible for sending and receiving the shared cursors (see the setSharedCursors command).
 *
 * This extension requires the IdListState extension.
 */
export interface SharedCursorOptions {
  /** The current client's ID, used to avoid rendering our own shared cursor.  */
  clientId: string;

  /**
   * A function that returns a DOM element for the cursor.
   * @param user The user details object
   * @example
   * render: user => {
   *  const cursor = document.createElement('span')
   *  cursor.classList.add('collaboration-carets__caret')
   *  cursor.setAttribute('style', `border-color: ${user.color}`)
   *
   *  const label = document.createElement('div')
   *  label.classList.add('collaboration-carets__label')
   *  label.setAttribute('style', `background-color: ${user.color}`)
   *  label.insertBefore(document.createTextNode(user.name), null)
   *
   *  cursor.insertBefore(label, null)
   *  return cursor
   * }
   */
  render(user: Record<string, any>): HTMLElement;

  /**
   * A function that returns a ProseMirror DecorationAttrs object for the selection.
   * @param user The user details object
   * @example
   * selectionRender: user => {
   * return {
   *  nodeName: 'span',
   *  class: 'collaboration-carets__selection',
   *  style: `background-color: ${user.color}`,
   *  'data-user': user.name,
   * }
   */
  selectionRender(user: Record<string, any>): DecorationAttrs;
}

/**
 * Tiptap extension that adds a ProseMirror plugin to store the IdList state
 * in the EditorState.
 *
 * Other extensions can access that state by calling getIdListState(newState)
 * in appendTransactions or state.apply.
 *
 * You must explicitly update the IdList along with each relevant transaction
 * by caling setIdListState(tr, idList) (or editor.commands.setIdListState(idList)).
 * Until then, our state will show as invalid; plugins that depend on it should
 * wait for a future tr with a valid state.
 */
export const SharedCursorsExtension = Extension.create<SharedCursorOptions>({
  name: 'idListState',

  // Relatively low (late) so that the rest of the doc is updated before we draw cursors.
  priority: 50,

  addOptions() {
    return {
      clientId: '',
      render: (user) => {
        const cursor = document.createElement('span');

        cursor.classList.add('collaboration-carets__caret');
        cursor.setAttribute('style', `border-color: ${user.color}`);

        const label = document.createElement('div');

        label.classList.add('collaboration-carets__label');
        label.setAttribute('style', `background-color: ${user.color}`);
        label.insertBefore(document.createTextNode(user.name), null);
        cursor.insertBefore(label, null);

        return cursor;
      },
      selectionRender: (user) => {
        return {
          style: `background-color: ${user.color}70`,
          class: 'Tiptap-shared-cursor-selection'
        };
      }
    };
  },

  addCommands() {
    return {
      setSharedCursors:
        (cursors: SharedCursor[]) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true;

          tr.setMeta(pluginKey, cursors);
          dispatch(tr);

          return true;
        }
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_config, _instance) => {
            return { cursors: [], decorations: DecorationSet.empty };
          },
          apply: (tr, value, oldState, newState) => {
            // Update cursors if commanded.
            const newCursors = tr.getMeta(pluginKey) as SharedCursor[] | undefined;
            const cursors = newCursors || value.cursors;

            // Update decorations if cursors or the IdList changed.
            // (If the IdList is invalid, we wait for a future tr to make it valid.
            // This should happen synchronously, so we don't bother step-mapping the old decorations.)
            let decorations = value.decorations;
            const { idList: oldIdList } = getIdListState(oldState);
            const { isValid, idList } = getIdListState(newState);
            if (isValid && (newCursors || idList !== oldIdList)) {
              decorations = createDecorations(newState, idList, cursors, this.options);
            }

            return { cursors, decorations };
          }
        } satisfies StateField<PluginStateType>,
        props: {
          decorations: (state) => {
            return (pluginKey.getState(state) as PluginStateType).decorations;
          }
        }
      })
    ];
  }
});

function createDecorations(
  state: EditorState,
  idList: IdList,
  cursors: SharedCursor[],
  options: SharedCursorOptions
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const cursor of cursors) {
    if (cursor.clientId === options.clientId) continue;
    if (!cursor.selection) continue;

    try {
      const pmSelection = selectionFromIds(cursor.selection, state.doc, idList);
      decorations.push(
        Decoration.widget(pmSelection.head, () => options.render(cursor.user), {
          key: cursor.clientId,
          side: 10
        })
      );
      decorations.push(
        Decoration.inline(pmSelection.from, pmSelection.to, options.selectionRender(cursor.user), {
          inclusiveEnd: true,
          inclusiveStart: false
        })
      );
    } catch (err) {
      // This can happen if the cursor state gets slightly ahead of the editor state - okay.
      console.error(`Invalid shared cursor for clientId ${cursor.clientId}, skipping`, err);
    }
  }

  return DecorationSet.create(state.doc, decorations);
}
