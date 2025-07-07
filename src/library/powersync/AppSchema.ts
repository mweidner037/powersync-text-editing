import { column, Schema, Table } from '@powersync/web';

// TODO: Rename 'documents'
export const LISTS_TABLE = 'lists';
export const TEXT_UPDATES_TABLE = 'text_updates';

const text_updates = new Table(
  {
    list_id: column.text,
    created_at: column.text,
    created_by: column.text,
    // Note: This column name causes trouble (reserved word). Need to quote in queries ("update").
    update: column.text,
    // null for local (uncommitted) updates.
    server_version: column.integer
  },
  { indexes: { list: ['list_id'] } }
);

const lists = new Table({
  created_at: column.text,
  name: column.text,
  owner_id: column.text
});

export const AppSchema = new Schema({
  text_updates,
  lists
});

export type Database = (typeof AppSchema)['types'];

export type TextUpdateRecord = Database['text_updates'];
export type ListRecord = Database['lists'];
