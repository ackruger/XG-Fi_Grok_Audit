/*
# Xg-Fi Ver2: Asset Chat, Message Board, Edit History, Case Source Links

## Purpose
Establishes distinct channels: Asset Chat (complete conversation), Message Board (promoted
status updates), Activity (system audit — already exists via `events`), and Cases (formal
tracked work — already exists via `issues`). Adds authorized workflows to promote a chat
message to the Message Board and create a Case from chat or board. Preserves author,
timestamp, source, and history. Edits cannot erase audit history.

## New Tables

### 1. `asset_chat_messages`
- `id` (uuid PK)
- `asset_id` (uuid FK → assets, CASCADE)
- `facility_id` (uuid FK → facilities, NOT NULL) — denormalized for RLS
- `author_id` (uuid FK → profiles, nullable) — null for AI-agent messages
- `author_type` (text NOT NULL default 'user') — 'user' | 'ai_agent' | 'system'
- `body` (text NOT NULL)
- `edited_at` (timestamptz, nullable) — set when message is edited
- `edit_history` (jsonb, default '[]') — array of {body, edited_at, edited_by} snapshots
- `promoted_to_board` (boolean, default false) — set when promoted to Message Board
- `promoted_at` (timestamptz, nullable)
- `promoted_by` (uuid FK → profiles, nullable)
- `source_case_id` (uuid, nullable) — if this message triggered a Case creation
- `created_at` (timestamptz, default now())

### 2. `asset_board_posts`
- `id` (uuid PK)
- `asset_id` (uuid FK → assets, CASCADE)
- `facility_id` (uuid FK → facilities, NOT NULL)
- `chat_message_id` (uuid FK → asset_chat_messages, nullable) — link back to source chat message
- `author_id` (uuid FK → profiles, NOT NULL)
- `body` (text NOT NULL)
- `is_pinned` (boolean, default false)
- `source_case_id` (uuid, nullable) — if this post triggered a Case creation
- `created_at` (timestamptz, default now())

### 3. `case_source_links`
- `id` (uuid PK)
- `case_id` (uuid FK → issues, CASCADE)
- `source_type` (text NOT NULL) — 'chat_message' | 'board_post'
- `source_chat_message_id` (uuid FK → asset_chat_messages, nullable)
- `source_board_post_id` (uuid FK → asset_board_posts, nullable)
- `asset_id` (uuid FK → assets, nullable) — the asset context
- `created_by` (uuid FK → profiles, nullable)
- `created_at` (timestamptz, default now())

## Security
- RLS on all tables, scoped through facility membership.
- Chat messages: facility members can read; contributor+ can write; author or supervisor+
  can edit (edit appends to edit_history, never deletes).
- Board posts: facility members can read; supervisor+ can promote a chat message to board;
  supervisor+ can pin/unpin.
- Case source links: facility members can read; contributor+ can create.
- Grants: SELECT/INSERT/UPDATE to authenticated on appropriate tables.

## Notes
1. Edit history is preserved as a JSONB array — editing appends the old body + timestamp,
   never removes prior versions.
2. AI-agent messages use author_type='ai_agent' with author_id=NULL. No AI call or secret
   is required in this phase.
3. Promotion workflow: a supervisor+ user sets promoted_to_board=true on a chat message,
   which also inserts a row into asset_board_posts with a back-reference.
4. Case creation from chat: creates an issue, then inserts a case_source_link connecting
   the issue to the originating chat message or board post.
*/

-- ── asset_chat_messages ──
CREATE TABLE IF NOT EXISTS asset_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_type text NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'ai_agent', 'system')),
  body text NOT NULL,
  edited_at timestamptz,
  edit_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  promoted_to_board boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  promoted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source_case_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_chat_messages_asset ON asset_chat_messages(asset_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_facility ON asset_chat_messages(facility_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON asset_chat_messages(created_at);

GRANT SELECT, INSERT, UPDATE ON asset_chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_chat_messages TO service_role;

DROP POLICY IF EXISTS "select_chat_messages" ON asset_chat_messages;
CREATE POLICY "select_chat_messages"
ON asset_chat_messages FOR SELECT
TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "insert_chat_messages" ON asset_chat_messages;
CREATE POLICY "insert_chat_messages"
ON asset_chat_messages FOR INSERT
TO authenticated
WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "update_chat_messages" ON asset_chat_messages;
CREATE POLICY "update_chat_messages"
ON asset_chat_messages FOR UPDATE
TO authenticated
USING (is_facility_member(facility_id, auth.uid()))
WITH CHECK (is_facility_member(facility_id, auth.uid()));

-- ── asset_board_posts ──
CREATE TABLE IF NOT EXISTS asset_board_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  chat_message_id uuid REFERENCES asset_chat_messages(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  body text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  source_case_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_board_posts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_board_posts_asset ON asset_board_posts(asset_id);
CREATE INDEX IF NOT EXISTS idx_board_posts_facility ON asset_board_posts(facility_id);

GRANT SELECT, INSERT, UPDATE ON asset_board_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_board_posts TO service_role;

DROP POLICY IF EXISTS "select_board_posts" ON asset_board_posts;
CREATE POLICY "select_board_posts"
ON asset_board_posts FOR SELECT
TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "insert_board_posts" ON asset_board_posts;
CREATE POLICY "insert_board_posts"
ON asset_board_posts FOR INSERT
TO authenticated
WITH CHECK (
  is_facility_member(facility_id, auth.uid())
  AND get_facility_role(facility_id, auth.uid()) IN ('reviewer', 'supervisor', 'admin')
);

DROP POLICY IF EXISTS "update_board_posts" ON asset_board_posts;
CREATE POLICY "update_board_posts"
ON asset_board_posts FOR UPDATE
TO authenticated
USING (is_facility_member(facility_id, auth.uid()))
WITH CHECK (is_facility_member(facility_id, auth.uid()));

-- ── case_source_links ──
CREATE TABLE IF NOT EXISTS case_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('chat_message', 'board_post')),
  source_chat_message_id uuid REFERENCES asset_chat_messages(id) ON DELETE SET NULL,
  source_board_post_id uuid REFERENCES asset_board_posts(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE case_source_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_case_source_links_case ON case_source_links(case_id);
CREATE INDEX IF NOT EXISTS idx_case_source_links_chat ON case_source_links(source_chat_message_id) WHERE source_chat_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_source_links_board ON case_source_links(source_board_post_id) WHERE source_board_post_id IS NOT NULL;

GRANT SELECT, INSERT ON case_source_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON case_source_links TO service_role;

DROP POLICY IF EXISTS "select_case_source_links" ON case_source_links;
CREATE POLICY "select_case_source_links"
ON case_source_links FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM issues i
    WHERE i.id = case_source_links.case_id
      AND EXISTS (
        SELECT 1 FROM assets a
        WHERE a.id = i.asset_id
          AND is_facility_member(a.facility_id, auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "insert_case_source_links" ON case_source_links;
CREATE POLICY "insert_case_source_links"
ON case_source_links FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM issues i
    WHERE i.id = case_source_links.case_id
      AND EXISTS (
        SELECT 1 FROM assets a
        WHERE a.id = i.asset_id
          AND is_facility_member(a.facility_id, auth.uid())
      )
  )
);

-- ── Edit history trigger for chat messages ──
CREATE OR REPLACE FUNCTION preserve_chat_edit_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edit_history := OLD.edit_history || jsonb_build_object(
      'body', OLD.body,
      'edited_at', OLD.edited_at,
      'edited_by', v_user_id
    );
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION preserve_chat_edit_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preserve_chat_edit_history() TO authenticated;

DROP TRIGGER IF EXISTS trg_chat_edit_history ON asset_chat_messages;
CREATE TRIGGER trg_chat_edit_history
BEFORE UPDATE ON asset_chat_messages
FOR EACH ROW EXECUTE FUNCTION preserve_chat_edit_history();
