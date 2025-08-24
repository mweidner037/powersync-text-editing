import { column, Schema, Table } from '@powersync/web';
import { PRESENCE_TABLE_SCHEMA } from './usePresence';

export const DOCUMENTS_TABLE = 'documents';
export const TEXT_UPDATES_TABLE = 'text_updates';
export const PRESENCE_TABLE = 'presence';

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
  { indexes: { documentIndex: ['doc_id'] } }
);

const presence = new Table(PRESENCE_TABLE_SCHEMA);

const documents = new Table({
  created_at: column.text,
  name: column.text,
  owner_id: column.text
});

export const AppSchema = new Schema({
  text_updates,
  presence,
  documents
});

export type Database = (typeof AppSchema)['types'];

export type TextUpdateRecord = Database[typeof TEXT_UPDATES_TABLE];
export type DocumentRecord = Database[typeof DOCUMENTS_TABLE];
export type PresenceRecord = Database[typeof PRESENCE_TABLE];
