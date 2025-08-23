import { usePowerSync, useQuery } from '@powersync/react';
import { Box, Button, CircularProgress, Typography, styled } from '@mui/material';
import Fab from '@mui/material/Fab';
import { MutableRefObject, Suspense, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSupabase } from '@/components/providers/SystemProvider';
import { DOCUMENTS_TABLE, SHARED_CURSORS_TABLE, TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import './styles.css';
import { useReducedTable } from '@/library/powersync/use_reduced_table';
import { buildTiptapExtensions } from '@/library/tiptap/extensions';
import {
  CollabTiptapStep,
  collabTiptapStepReducer,
  ElementIdGenerator,
  updateToSteps
} from '@/library/tiptap/step_converter';
import { IdList } from 'articulated';
import { IdSelection, selectionFromIds, selectionToIds } from '@/library/tiptap/selection';
import { TextSelection } from '@tiptap/pm/state';
import MenuBar from '../../../../components/editor/MenuBar';
import { getIdListState, setIdListState } from '@/library/tiptap/plugins/id-list-state';
import { v4 as uuidv4 } from 'uuid';
import { randomName, randomColor } from '@/library/utils';
import { SharedCursor } from '@/library/tiptap/plugins/shared-cursors';
import _ from 'lodash';
import { SetPowerSyncParams } from '@/components/widgets/SetPowerSyncParams';

interface UserData {
  name: string;
  color: string;
}

const DocumentEditSection = () => {
  // PowerSync queries

  const powerSync = usePowerSync();
  const supabase = useSupabase();
  const { id: docID } = useParams();

  const [version, setVersion] = useState(0);

  useEffect(() => {
    void (async () => {
      if (supabase) {
        await powerSync.disconnect();
        console.log('disconnected');
        // Pass docID as a param so we sync its bucket, even if it's not one of our documents
        // (including when we are logged in anonymously).
        await powerSync.connect(supabase, { params: { current_doc_id: docID } });
        console.log('connected');
        setVersion(version + 1);
      }
    })();
  }, [docID, supabase]);

  const {
    data: [documentRecord]
  } = useQuery<{ name: string }>(`SELECT name FROM ${DOCUMENTS_TABLE} WHERE id = ?`, [docID]);

  // Our shared cursor

  const clientIdRef = useRef('');
  const userDataRef = useRef<UserData>({ name: '', color: '' });
  if (!clientIdRef.current) {
    // This needs to unique to the editor instance - can't be userId.
    const clientId = uuidv4();
    clientIdRef.current = clientId;
    userDataRef.current = {
      // TODO: Get name from account?
      name: randomName(),
      color: randomColor()
    };
  }

  useEffect(() => {
    void powerSync.execute(
      `INSERT INTO ${SHARED_CURSORS_TABLE} (id, doc_id, expires_at, user_data, selection)
    VALUES (?, ?, (datetime('now', '+30 seconds')), ?, ?)`,
      [clientIdRef.current, docID, JSON.stringify(userDataRef.current), null]
    );

    return () => {
      // Best-effort delete. If this fails, the row will expire shortly.
      void powerSync.execute(`DELETE FROM ${SHARED_CURSORS_TABLE} WHERE id = ?`, [clientIdRef.current]);
    };
  }, []);

  // PowerSync mutations

  const pendingUpdateCounterRef = useRef(0);

  const doUpdate = async (update: CollabTiptapStep[]) => {
    const userID = supabase?.currentSession?.user.id;
    if (!userID) {
      throw new Error(`Could not get user ID.`);
    }

    pendingUpdateCounterRef.current++;
    try {
      await powerSync.execute(
        `INSERT INTO
                ${TEXT_UPDATES_TABLE}
                    (id, created_at, created_by, "update", doc_id)
                VALUES
                    (uuid(), datetime(), ?, ?, ?)`,
        [userID, JSON.stringify(update), docID!]
      );
    } finally {
      pendingUpdateCounterRef.current--;
    }
  };
  const updatedSharedCursor = _.throttle(async (selection: IdSelection) => {
    await powerSync.execute(
      `UPDATE ${SHARED_CURSORS_TABLE} SET expires_at = (datetime('now', '+30 seconds')), selection = ? WHERE id = ?`,
      [JSON.stringify(selection), clientIdRef.current]
    );
  }, 500);
  const clear = async () => {
    await powerSync.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE doc_id = ?`, [docID!]);
    await powerSync.execute(`DELETE FROM ${SHARED_CURSORS_TABLE} WHERE doc_id = ?`, [docID!]);
  };

  // Tiptap setup

  const idGenRef = useRef<ElementIdGenerator>(new ElementIdGenerator());
  const editor = useEditor({
    extensions: buildTiptapExtensions(clientIdRef.current),
    // We update the editor's state each render with a tr, so turn this off
    // to prevent an infinite rerender loop.
    shouldRerenderOnTransaction: false,
    onUpdate({ transaction, editor }) {
      const [steps, newIdList] = updateToSteps(transaction, getIdListState(editor.state).idList, idGenRef.current);
      // It would be cleaner to add the new IdList to transaction and then dispatch it,
      // like when using ProseMirror's dispatchTransaction prop.
      // That way the state is updated before any local plugins see this transaction.
      // With Tiptap, we instead need to update it afterwards and trust plugins to not
      // read the state on local updates.
      editor.commands.setIdListState(newIdList);

      if (steps.length > 0) void doUpdate(steps);
    },
    onSelectionUpdate({ transaction, editor }) {
      if (transaction.getMeta('ourRemoteUpdate')) return;

      const { isValid, idList } = getIdListState(editor.state);
      if (!isValid) return;
      const idSelection = selectionToIds(editor.state.selection, idList);

      void updatedSharedCursor(idSelection);

      // TODO: also null/set on focus in/out, like y-cursor.
      // TODO: Hearbeat
    }
  });

  // Render

  if (!documentRecord) {
    return (
      <Box>
        <Typography>No matching document found, please navigate back...</Typography>
      </Box>
    );
  }

  return (
    <NavigationPage title={`Document: ${documentRecord.name}`}>
      <Box>
        <MenuBar editor={editor} />
        <EditorContent editor={editor} />
        {editor ? (
          <>
            <EditorController
              key={docID + '-editor'}
              docID={docID!}
              editor={editor}
              pendingUpdateCounterRef={pendingUpdateCounterRef}
            />
            <SharedCursorQuery key={docID + '-cursors'} docID={docID!} editor={editor} />
          </>
        ) : null}
        <Button onClick={clear}>Clear</Button>
      </Box>
    </NavigationPage>
  );
};

function EditorController({
  docID,
  editor,
  pendingUpdateCounterRef
}: {
  docID: string;
  editor: Editor;
  pendingUpdateCounterRef: MutableRefObject<number>;
}) {
  // On each render, set the editor's state to that indicated by TEXT_UPDATES_TABLE,
  // and update idListRef to match.
  // Except, preserve the selection in a collaboration-aware way using IdList.

  const startingIdList = getIdListState(editor.state).idList;

  // - Reset the state, since we (re-)apply all updates below.
  const tr = editor.state.tr;
  tr.delete(0, tr.doc.content.size);
  const initialSize = tr.doc.content.size;
  const initialIdList = IdList.new().insertAfter(null, { bunchId: 'init', counter: 0 }, initialSize);

  // - Apply all updates to tr and idListRef.
  const { data: reducedResult, isFetching } = useReducedTable(
    TEXT_UPDATES_TABLE,
    docID,
    { tr, idList: initialIdList },
    collabTiptapStepReducer
  );

  if (isFetching || pendingUpdateCounterRef.current > 0) {
    // After performing a local update, we need to wait for the reduced state to be at least
    // as up-to-date before touching the editor.
    // Otherwise, the editor's state goes backwards, potentially causing jitter
    // and also confusing our restore-selection code.
    // Empirically, the reduced state is updated once:
    // - All of the pending powerSync.execute promises have resolved, and
    // - isFetching is false.
    return null;
  }

  setIdListState(tr, reducedResult.idList);

  // - Restore the starting selection in a collaboration-aware way.
  // We do this by converting the initial selection to ElementIds and back.
  const startingSelection = editor.state.selection;
  const idSelection = selectionToIds(startingSelection, startingIdList);
  try {
    tr.setSelection(selectionFromIds(idSelection, tr.doc, reducedResult.idList));
  } catch (error) {
    // This can happen naturally if the state goes backwards somehow. Clear the selection and don't crash.
    tr.setSelection(TextSelection.create(tr.doc, 0));
    console.error('Error restoring selection', error);
  }

  // - Update the editor.
  tr.setMeta('ourRemoteUpdate', true);
  editor.view.updateState(editor.state.apply(tr));

  // Not a real component, just a wrapper for hooks.
  return null;
}

function SharedCursorQuery({ docID, editor }: { docID: string; editor: Editor }) {
  // TODO: Need to rerun this on a timer, not just when data changes (since now() also changes).
  // Could do that always to debounce as well.
  const { data: cursorRows } = useQuery<{ id: string; user_data: string; selection: string | null }>(
    `
    SELECT id, user_data, selection FROM ${SHARED_CURSORS_TABLE}
    WHERE doc_id=?
    AND datetime('now') < expires_at`,
    [docID]
  );
  // TODO: clock sync issues. Currently we're trusting all clients to be in sync.
  // Setting a server expires_at would need a trigger and still won't be in sync with clients.

  const cursors = cursorRows.map(
    ({ id, user_data, selection }): SharedCursor => ({
      clientId: id,
      selection: selection ? JSON.parse(selection) : null,
      user: JSON.parse(user_data)
    })
  );
  editor.commands.setSharedCursors(cursors);

  return null;
}

export default function DocumentEditPage() {
  const { id: docID } = useParams();

  const supabase = useSupabase();
  if (!supabase) {
    console.error(`No Supabase connector has been created yet.`);
    return;
  }

  return (
    <Box>
      <Suspense fallback={<CircularProgress />}>
        <SetPowerSyncParams connector={supabase} params={{ current_doc_id: docID }}>
          {/* TODO: Wait until synced, so we don't show the "no document" message.
              GuardBySync does not work for that. */}
          <DocumentEditSection />
        </SetPowerSyncParams>
      </Suspense>
    </Box>
  );
}

namespace S {
  export const FloatingActionButton = styled(Fab)`
    position: absolute;
    bottom: 20px;
    right: 20px;
  `;
}
