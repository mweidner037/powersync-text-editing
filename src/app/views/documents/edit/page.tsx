import { useQuery } from '@powersync/react';
import { Box, CircularProgress, Typography, Switch, FormControlLabel } from '@mui/material';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSupabase } from '@/components/providers/SystemProvider';
import { DOCUMENTS_TABLE } from '@/library/powersync/AppSchema';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { TiptapEditor } from '@/components/editor/TiptapEditor';

export default function DocumentEditPage() {
  const { id: docID } = useParams();
  const supabase = useSupabase();

  const [isActive, setIsActive] = useState(true);

  const queryOutput = useQuery<{ name: string }>(`SELECT name FROM ${DOCUMENTS_TABLE} WHERE id = ?`, [docID], {
    // Wait for all streams associated to this document to load before showing the document.
    streams: [
      { name: 'current_document_documents', parameters: { current_doc_id: docID }, waitForStream: true },
      { name: 'current_document_text_updates', parameters: { current_doc_id: docID }, waitForStream: true },
      { name: 'current_document_presence', parameters: { current_doc_id: docID }, waitForStream: true }
    ]
  });

  console.log('useQuery output:', queryOutput);
  const { isLoading, data } = queryOutput;

  if (isLoading || !data) {
    return <CircularProgress />;
  }

  const [documentRecord] = data;
  if (!documentRecord) {
    return (
      <Box>
        <Typography>No matching document found, please navigate back...</Typography>
      </Box>
    );
  }

  const userID = supabase?.currentSession?.user.id;
  if (!userID) {
    throw new Error(`Could not get user ID.`);
  }

  return (
    <NavigationPage title={`Document: ${documentRecord.name}`}>
      <FormControlLabel
        control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
        label="Sync Active"
      />
      <TiptapEditor docID={docID!} userID={userID} isActive={isActive} />
    </NavigationPage>
  );
}
