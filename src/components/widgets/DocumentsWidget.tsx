import { usePowerSync, useQuery } from '@powersync/react';
import { List } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { DocumentItemWidget } from './DocumentItemWidget';
import { DOCUMENTS_TABLE, DocumentRecord, TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { DOCUMENTS_ROUTE } from '@/app/router';
import { useSupabase } from '../providers/SystemProvider';

export type DocumentsWidgetProps = {
  selectedId?: string;
};

export function DocumentsWidget(props: DocumentsWidgetProps) {
  const connector = useSupabase();
  const powerSync = usePowerSync();
  const navigate = useNavigate();

  const userId = connector?.currentSession?.user.id;

  const { data: documentRecords, isLoading } = useQuery<DocumentRecord>(
    `
      SELECT
        ${DOCUMENTS_TABLE}.*
      FROM
        ${DOCUMENTS_TABLE}
      WHERE owner_id = ?`,
    [userId]
  );

  const deleteDocument = async (id: string) => {
    await powerSync.writeTransaction(async (tx) => {
      // Delete associated updates
      await tx.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE doc_id = ?`, [id]);
      // Delete document record
      await tx.execute(`DELETE FROM ${DOCUMENTS_TABLE} WHERE id = ?`, [id]);
    });
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <List dense={false}>
      {documentRecords.map((r) => (
        <DocumentItemWidget
          key={r.id}
          title={r.name ?? ''}
          selected={r.id == props.selectedId}
          onDelete={() => deleteDocument(r.id)}
          onPress={() => {
            navigate(DOCUMENTS_ROUTE + '/' + r.id);
          }}
        />
      ))}
    </List>
  );
}
