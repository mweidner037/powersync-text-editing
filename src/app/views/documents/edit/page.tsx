import { useQuery } from '@powersync/react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useSupabase } from '@/components/providers/SystemProvider';
import { DOCUMENTS_TABLE } from '@/library/powersync/AppSchema';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { SetPowerSyncParams } from '@/components/widgets/SetPowerSyncParams';
import { GuardBySync } from '@/components/widgets/GuardBySync';
import { TiptapEditor } from '@/components/editor/TiptapEditor';

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
        {/* Pass docID as a param so we sync its bucket, even if it's not one of our documents
            (including when we are logged in anonymously). */}
        <SetPowerSyncParams connector={supabase} params={{ current_doc_id: docID }}>
          <GuardBySync>
            <DocumentEditSection docID={docID!} />
          </GuardBySync>
        </SetPowerSyncParams>
      </Suspense>
    </Box>
  );
}

const DocumentEditSection = ({ docID }: { docID: string }) => {
  const supabase = useSupabase();

  const {
    data: [documentRecord]
  } = useQuery<{ name: string }>(`SELECT name FROM ${DOCUMENTS_TABLE} WHERE id = ?`, [docID]);

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
      <TiptapEditor docID={docID} userID={userID} />
    </NavigationPage>
  );
};
