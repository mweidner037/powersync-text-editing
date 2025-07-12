import { usePowerSync, useQuery } from '@powersync/react';
import { Box, Button, CircularProgress, Typography, styled } from '@mui/material';
import Fab from '@mui/material/Fab';
import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useSupabase } from '@/components/providers/SystemProvider';
import { LISTS_TABLE, TEXT_UPDATES_TABLE, TextUpdateRecord } from '@/library/powersync/AppSchema';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { useEditor, EditorContent } from '@tiptap/react';
import { Paragraph } from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Document from '@tiptap/extension-document';
import './styles.css';

const extensions = [Document, Paragraph, Text];
const content = '<p>Hello World!</p>';

const DocumentEditSection = () => {
  // PowerSync queries

  const powerSync = usePowerSync();
  const supabase = useSupabase();
  const { id: listID } = useParams();

  const {
    data: [listRecord]
  } = useQuery<{ name: string }>(`SELECT name FROM ${LISTS_TABLE} WHERE id = ?`, [listID]);

  const { data: remoteRows } = useQuery<TextUpdateRecord>(
    `SELECT * FROM ${TEXT_UPDATES_TABLE} WHERE list_id=? AND server_version IS NOT NULL ORDER BY server_version`,
    [listID]
  );
  const { data: localRowsText } = useQuery<{ id: string; data: string }>(
    "SELECT json_extract(data, '$.id') AS id, json_extract(data, '$.data') AS data FROM ps_crud WHERE json_extract(data, '$.op', '$.type', '$.data.list_id') = json_array('PUT',?,?) ORDER BY id",
    [TEXT_UPDATES_TABLE, listID]
  );
  const localRows = localRowsText.map((row) => ({ id: row.id, ...JSON.parse(row.data) } as TextUpdateRecord));

  const allRows = [...remoteRows, ...localRows];
  console.log('All rows', allRows);

  // PowerSync mutations

  const testUpdate = async () => {
    const userID = supabase?.currentSession?.user.id;
    if (!userID) {
      throw new Error(`Could not get user ID.`);
    }

    await powerSync.execute(
      `INSERT INTO
                ${TEXT_UPDATES_TABLE}
                    (id, created_at, created_by, "update", list_id)
                VALUES
                    (uuid(), datetime(), ?, ?, ?)`,
      [userID, "{ type: 'test' }", listID!]
    );
  };
  const clear = async () => {
    await powerSync.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE list_id = ?`, [listID!]);
  };

  // Tiptap setup

  const editor = useEditor({
    extensions,
    content
  });

  // Render

  if (!listRecord) {
    return (
      <Box>
        <Typography>No matching document found, please navigate back...</Typography>
      </Box>
    );
  }

  return (
    <NavigationPage title={`Document: ${listRecord.name}`}>
      <Box>
        <EditorContent editor={editor} />
        <Button onClick={testUpdate}>Test Update</Button>
        <br />
        <Button onClick={clear}>Clear</Button>
      </Box>
    </NavigationPage>
  );
};

export default function DocumentEditPage() {
  return (
    <Box>
      <Suspense fallback={<CircularProgress />}>
        <DocumentEditSection />
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
