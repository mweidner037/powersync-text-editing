-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text NOT NULL,
  owner_id uuid NOT NULL,
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT lists_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id)
);
CREATE TABLE public.presence (
  id uuid NOT NULL,
  client_id uuid NOT NULL,
  room_id text NOT NULL,
  user_id uuid NOT NULL,
  is_remote boolean DEFAULT true,
  expires_at_local bigint,
  data text NOT NULL,
  version integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT presence_pkey PRIMARY KEY (id)
);
CREATE TABLE public.text_updates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  update text NOT NULL,
  created_by uuid DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL DEFAULT gen_random_uuid(),
  server_version bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  CONSTRAINT text_updates_pkey PRIMARY KEY (id),
  CONSTRAINT text_updates_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.documents(id),
  CONSTRAINT text_updates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

-- pg_cron job
SELECT cron.schedule('cleanup_presence', '15 seconds', 'DELETE FROM presence WHERE created_at < NOW() - INTERVAL ''30 seconds'';');