/*
# Import Batches and Import Records

Stage 3B-1: Controlled asset import audit trail.

## 1. New Tables

### asset_import_batches
  - id (uuid, PK) — batch identifier
  - project_id (uuid, FK → projects) — target project
  - source_filename (text) — original CSV filename
  - source_fingerprint (text) — SHA-256 hex hash of raw CSV content
  - status (text) — pending | in_progress | completed | failed | rolled_back
  - started_by (uuid, FK → auth.users) — user who initiated
  - started_at, completed_at (timestamptz) — timing
  - Counter columns for assets_created, profiles_created, etc.

### asset_import_records
  - id (uuid, PK) — per-record log entry
  - batch_id (uuid, FK → asset_import_batches)
  - source_row, source_section, source_asset_tag, normalized_equipment_name
  - import_decision (ready | review | exclude)
  - result (created | merged_profile | skipped | review | failed)
  - asset_id (uuid, nullable, FK → assets)
  - message (text)

## 2. Security
  - RLS on both tables via is_project_member(project_id, auth.uid())
  - Writes restricted to supervisor/admin
  - Duplicate import prevention via unique partial index on fingerprint

## 3. Indexes
  - batch_id, project_id, asset_id indexes for fast lookups
*/

CREATE TABLE IF NOT EXISTS asset_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  source_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'rolled_back')),
  started_by uuid NOT NULL REFERENCES auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  records_analyzed int NOT NULL DEFAULT 0,
  records_selected int NOT NULL DEFAULT 0,
  assets_created int NOT NULL DEFAULT 0,
  profiles_created int NOT NULL DEFAULT 0,
  attribute_values_created int NOT NULL DEFAULT 0,
  relationships_created int NOT NULL DEFAULT 0,
  service_parts_created int NOT NULL DEFAULT 0,
  warnings_count int NOT NULL DEFAULT 0,
  errors_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batch_fingerprint_active
  ON asset_import_batches (project_id, source_fingerprint)
  WHERE status IN ('completed', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_import_batches_project
  ON asset_import_batches (project_id);

ALTER TABLE asset_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_import_batches" ON asset_import_batches;
CREATE POLICY "select_import_batches" ON asset_import_batches
  FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "insert_import_batches" ON asset_import_batches;
CREATE POLICY "insert_import_batches" ON asset_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_project_member(project_id, auth.uid())
    AND public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "update_import_batches" ON asset_import_batches;
CREATE POLICY "update_import_batches" ON asset_import_batches
  FOR UPDATE TO authenticated
  USING (
    public.is_project_member(project_id, auth.uid())
    AND public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    public.is_project_member(project_id, auth.uid())
    AND public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "delete_import_batches" ON asset_import_batches;
CREATE POLICY "delete_import_batches" ON asset_import_batches
  FOR DELETE TO authenticated
  USING (
    public.is_project_member(project_id, auth.uid())
    AND public.get_project_role(project_id, auth.uid()) = 'admin'
  );

-- Import records table
CREATE TABLE IF NOT EXISTS asset_import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES asset_import_batches(id) ON DELETE CASCADE,
  source_row int NOT NULL,
  source_section text NOT NULL,
  source_asset_tag text,
  normalized_equipment_name text NOT NULL,
  import_decision text NOT NULL DEFAULT 'ready'
    CHECK (import_decision IN ('ready', 'review', 'exclude')),
  result text NOT NULL DEFAULT 'review'
    CHECK (result IN ('created', 'merged_profile', 'skipped', 'review', 'failed')),
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_records_batch
  ON asset_import_records (batch_id);

CREATE INDEX IF NOT EXISTS idx_import_records_asset
  ON asset_import_records (asset_id);

ALTER TABLE asset_import_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_import_records" ON asset_import_records;
CREATE POLICY "select_import_records" ON asset_import_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM asset_import_batches b
      WHERE b.id = asset_import_records.batch_id
      AND public.is_project_member(b.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_import_records" ON asset_import_records;
CREATE POLICY "insert_import_records" ON asset_import_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM asset_import_batches b
      WHERE b.id = asset_import_records.batch_id
      AND public.is_project_member(b.project_id, auth.uid())
      AND public.get_project_role(b.project_id, auth.uid()) IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "update_import_records" ON asset_import_records;
CREATE POLICY "update_import_records" ON asset_import_records
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM asset_import_batches b
      WHERE b.id = asset_import_records.batch_id
      AND public.is_project_member(b.project_id, auth.uid())
      AND public.get_project_role(b.project_id, auth.uid()) IN ('supervisor', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM asset_import_batches b
      WHERE b.id = asset_import_records.batch_id
      AND public.is_project_member(b.project_id, auth.uid())
      AND public.get_project_role(b.project_id, auth.uid()) IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "delete_import_records" ON asset_import_records;
CREATE POLICY "delete_import_records" ON asset_import_records
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM asset_import_batches b
      WHERE b.id = asset_import_records.batch_id
      AND public.is_project_member(b.project_id, auth.uid())
      AND public.get_project_role(b.project_id, auth.uid()) = 'admin'
    )
  );
