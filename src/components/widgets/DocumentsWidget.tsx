import { usePowerSync, useQuery } from '@powersync/react';
import { List } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ListItemWidget } from './ListItemWidget';
import { LISTS_TABLE, ListRecord, TEXT_UPDATES_TABLE } from '@/library/powersync/AppSchema';
import { TODO_LISTS_ROUTE } from '@/app/router';

export type DocumentsWidgetProps = {
  selectedId?: string;
};

const description = (total: number, completed: number = 0) => {
  return `${total - completed} pending, ${completed} completed`;
};

export function DocumentsWidget(props: DocumentsWidgetProps) {
  const powerSync = usePowerSync();
  const navigate = useNavigate();

  const { data: listRecords, isLoading } = useQuery<ListRecord>(`
      SELECT
        ${LISTS_TABLE}.*
      FROM
        ${LISTS_TABLE}
      `);

  const deleteList = async (id: string) => {
    await powerSync.writeTransaction(async (tx) => {
      // Delete associated todos
      await tx.execute(`DELETE FROM ${TEXT_UPDATES_TABLE} WHERE list_id = ?`, [id]);
      // Delete list record
      await tx.execute(`DELETE FROM ${LISTS_TABLE} WHERE id = ?`, [id]);
    });
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <List dense={false}>
      {listRecords.map((r) => (
        <ListItemWidget
          key={r.id}
          title={r.name ?? ''}
          description={'TODO: description'}
          selected={r.id == props.selectedId}
          onDelete={() => deleteList(r.id)}
          onPress={() => {
            navigate(TODO_LISTS_ROUTE + '/' + r.id);
          }}
        />
      ))}
    </List>
  );
}
