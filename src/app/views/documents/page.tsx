import { usePowerSync, useStatus } from '@powersync/react';
import AddIcon from '@mui/icons-material/Add';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  styled
} from '@mui/material';
import Fab from '@mui/material/Fab';
import React from 'react';
import { useSupabase } from '@/components/providers/SystemProvider';
import { DOCUMENTS_TABLE } from '@/library/powersync/AppSchema';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { DocumentsWidget } from '@/components/widgets/DocumentsWidget';
import { GuardBySync } from '@/components/widgets/GuardBySync';

export default function DocumentsPage() {
  const powerSync = usePowerSync();
  const supabase = useSupabase();
  const status = useStatus();

  const [showPrompt, setShowPrompt] = React.useState(false);
  const nameInputRef = React.createRef<HTMLInputElement>();

  const createNewDocument = async (name: string) => {
    const session = await supabase?.client.auth.getSession();
    const userID = session?.data.session?.user?.id;
    if (!userID) {
      throw new Error(`Could not create new document, no userID found`);
    }

    const res = await powerSync.execute(
      `INSERT INTO ${DOCUMENTS_TABLE} (id, created_at, name, owner_id) VALUES (uuid(), datetime(), ?, ?) RETURNING *`,
      [name, userID]
    );

    const resultRecord = res.rows?.item(0);
    if (!resultRecord) {
      throw new Error('Could not create document');
    }
  };

  return (
    <NavigationPage title="Documents">
      <Box>
        <S.FloatingActionButton onClick={() => setShowPrompt(true)}>
          <AddIcon />
        </S.FloatingActionButton>
        <Box>
          <GuardBySync>
            <DocumentsWidget />
          </GuardBySync>
        </Box>
        {/* TODO use a dialog service in future, this is just a simple example app */}
        <Dialog
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          PaperProps={{
            component: 'form',
            onSubmit: async (event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              await createNewDocument(nameInputRef.current!.value);
              setShowPrompt(false);
            }
          }}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description">
          <DialogTitle id="alert-dialog-title">{'Create Document'}</DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">Enter a name for a new document</DialogContentText>
            <TextField sx={{ marginTop: '10px' }} fullWidth inputRef={nameInputRef} label="Document Name" autoFocus />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowPrompt(false)}>Cancel</Button>
            <Button type="submit">Create</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </NavigationPage>
  );
}

namespace S {
  export const FloatingActionButton = styled(Fab)`
    position: absolute;
    bottom: 20px;
    right: 20px;
  `;
}
