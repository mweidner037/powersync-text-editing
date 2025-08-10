import { EditorState, Plugin, PluginKey, StateField, Transaction } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { IdList } from 'articulated';

const idListStatePluginKey = new PluginKey('idListState');

export function getIdListState(editorState: EditorState): IdList {
  const state = idListStatePluginKey.getState(editorState) as IdList | undefined;
  if (!state) {
    throw new Error('IdListStateExtension not installed (or not yet initialized)');
  }
  return state;
}

export function setIdListState(tr: Transaction, idList: IdList): Transaction {
  tr.setMeta(idListStatePluginKey, idList);
  return tr;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    setIdListState: {
      /**
       * Normalize nodes to a simple paragraph.
       * @example editor.commands.clearNodes()
       */
      setIdListState: (idList: IdList) => ReturnType;
    };
  }
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
 * Note that in onUpdate, plugins called on the original transaction (before the command)
 * will see the old IdList state.
 */
export const IdListStateExtension = Extension.create({
  name: 'idListState',

  // Relatively low (early) so that other plugins can see our updated state field
  // in https://prosemirror.net/docs/ref/#state.StateField.apply .
  priority: 50,

  addCommands() {
    return {
      setIdListState:
        (idList: IdList) =>
        ({ tr, dispatch }) => {
          dispatch?.(setIdListState(tr, idList));
          return true;
        }
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: idListStatePluginKey,
        state: {
          init(_config, instance) {
            // Note: This assumes that all collaborators have the same initial state
            // (e.g. the schema's empty state).
            const initialSize = instance.doc.content.size;
            return IdList.new().insertAfter(null, { bunchId: 'init', counter: 0 }, initialSize);
          },
          apply(tr, value, _oldState, _newState) {
            const newIdList = tr.getMeta(idListStatePluginKey) as IdList | undefined;
            if (newIdList) return newIdList;
            else return value;
          }
        } satisfies StateField<IdList>
      })
    ];
  }
});
