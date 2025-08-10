import { column, Schema, Table } from '@powersync/web';

// TODO: Rename 'documents'
export const LISTS_TABLE = 'lists';
export const TEXT_UPDATES_TABLE = 'text_updates';
export const SHARED_CURSORS_TABLE = 'shared_cursors';

const text_updates = new Table(
  {
    doc_id: column.text,
    created_at: column.text,
    created_by: column.text,
    // Note: This column name causes trouble (reserved word). Need to quote in queries ("update").
    update: column.text,
    // null for local (uncommitted) updates.
    server_version: column.integer
  },
  { indexes: { list: ['doc_id'] } }
);

const shared_cursors = new Table({
  doc_id: column.text,
  expires_at: column.text,
  user_data: column.text,
  selection: column.text
});

const lists = new Table({
  created_at: column.text,
  name: column.text,
  owner_id: column.text
});

export const AppSchema = new Schema({
  text_updates,
  shared_cursors,
  lists
});

export type Database = (typeof AppSchema)['types'];

export type TextUpdateRecord = Database[typeof TEXT_UPDATES_TABLE];
export type ListRecord = Database[typeof LISTS_TABLE];
export type SharedCursorRecord = Database[typeof SHARED_CURSORS_TABLE];
