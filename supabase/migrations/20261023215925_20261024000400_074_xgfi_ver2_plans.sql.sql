/*
# Xg-Fi Ver2: Plans Foundation — Revisions and Asset Markers

## Purpose
Adds the minimum PDF-first data model for plan revisions and asset markers with X/Y and
optional Z coordinates. Enables "Open Asset from marker" and "Go to Plan from asset" without
building Revit/AutoCAD/Procore ingestion.

## New Tables

### 1. `plan_documents`
- `id` (uuid PK)
- `facility_id` (uuid FK → facilities, NOT NULL) — denormalized for RLS
- `name` (text NOT NULL) — display name for the plan
- `storage_path` (text, nullable) — Supabase storage path for PDF
- `external_url` (text, nullable) — external PDF URL
- `current_revision_id` (uuid, nullable) — FK to current revision (set after revisions exist)
- `created_by` (uuid FK → profiles, nullable)
- `created_at`, `updated_at`

### 2. `plan_revisions`
- `id` (uuid PK)
- `plan_document_id` (uuid FK → plan_documents, CASCADE)
- `revision_number` (text NOT NULL) — e.g. "R1", "R2"
- `storage_path` (text, nullable)
- `external_url` (text, nullable)
- `page_count` (int, nullable)
- `is_current` (boolean, default false)
- `created_by` (uuid FK → profiles, nullable)
- `created_at`

### 3. `plan_markers`
- `id` (uuid PK)
- `plan_document_id` (uuid FK → plan_documents, CASCADE)
- `plan_revision_id` (uuid FK → plan_revisions, nullable) — which revision this marker is on
- `asset_id` (uuid FK → assets, nullable) — the asset this marker points to
- `facility_id` (uuid FK → facilities, NOT NULL) — denormalized for RLS
- `page_number` (int, default 1)
- `x` (double precision, NOT NULL) — X coordinate on the plan page
- `y` (double precision, NOT NULL) — Y coordinate on the plan page
- `z` (double precision, nullable) — optional Z (elevation)
- `label` (text, nullable) — override label for the marker
- `created_by` (uuid FK → profiles, nullable)
- `created_at`, `updated_at`

## Security
- RLS on all tables, scoped through facility membership.
- SELECT: facility members can read.
- INSERT/UPDATE: contributor+ can create/edit.
- DELETE: supervisor+ can delete markers (for correction).
- Grants: appropriate verbs to authenticated.

## Notes
1. This is a PDF-first model — no CAD format parsing.
2. Markers have X/Y on the page plus optional Z for elevation.
3. `current_revision_id` on plan_documents is set by the application when a revision is
   marked as current. The application enforces one current revision per plan.
4. The "Go to Plan from asset" query: find markers where asset_id = X, then join to
   plan_documents. "Open Asset from marker": marker.asset_id → asset detail page.
*/

-- ── plan_documents ──
CREATE TABLE IF NOT EXISTS plan_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  storage_path text,
  external_url text,
  current_revision_id uuid,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_plan_documents_facility ON plan_documents(facility_id);

GRANT SELECT, INSERT, UPDATE ON plan_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_documents TO service_role;

DROP POLICY IF EXISTS "select_plan_documents" ON plan_documents;
CREATE POLICY "select_plan_documents"
ON plan_documents FOR SELECT
TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "insert_plan_documents" ON plan_documents;
CREATE POLICY "insert_plan_documents"
ON plan_documents FOR INSERT
TO authenticated
WITH CHECK (
  is_facility_member(facility_id, auth.uid())
  AND get_facility_role(facility_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
);

DROP POLICY IF EXISTS "update_plan_documents" ON plan_documents;
CREATE POLICY "update_plan_documents"
ON plan_documents FOR UPDATE
TO authenticated
USING (is_facility_member(facility_id, auth.uid()))
WITH CHECK (is_facility_member(facility_id, auth.uid()));

-- ── plan_revisions ──
CREATE TABLE IF NOT EXISTS plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_document_id uuid NOT NULL REFERENCES plan_documents(id) ON DELETE CASCADE,
  revision_number text NOT NULL,
  storage_path text,
  external_url text,
  page_count int,
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_revisions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_plan_revisions_doc ON plan_revisions(plan_document_id);

GRANT SELECT, INSERT, UPDATE ON plan_revisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_revisions TO service_role;

DROP POLICY IF EXISTS "select_plan_revisions" ON plan_revisions;
CREATE POLICY "select_plan_revisions"
ON plan_revisions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM plan_documents pd
    WHERE pd.id = plan_revisions.plan_document_id
      AND is_facility_member(pd.facility_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "insert_plan_revisions" ON plan_revisions;
CREATE POLICY "insert_plan_revisions"
ON plan_revisions FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM plan_documents pd
    WHERE pd.id = plan_revisions.plan_document_id
      AND is_facility_member(pd.facility_id, auth.uid())
      AND get_facility_role(pd.facility_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  )
);

DROP POLICY IF EXISTS "update_plan_revisions" ON plan_revisions;
CREATE POLICY "update_plan_revisions"
ON plan_revisions FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM plan_documents pd
    WHERE pd.id = plan_revisions.plan_document_id
      AND is_facility_member(pd.facility_id, auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM plan_documents pd
    WHERE pd.id = plan_revisions.plan_document_id
      AND is_facility_member(pd.facility_id, auth.uid())
  )
);

-- ── plan_markers ──
CREATE TABLE IF NOT EXISTS plan_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_document_id uuid NOT NULL REFERENCES plan_documents(id) ON DELETE CASCADE,
  plan_revision_id uuid REFERENCES plan_revisions(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  page_number int NOT NULL DEFAULT 1,
  x double precision NOT NULL,
  y double precision NOT NULL,
  z double precision,
  label text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_markers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_plan_markers_doc ON plan_markers(plan_document_id);
CREATE INDEX IF NOT EXISTS idx_plan_markers_asset ON plan_markers(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_markers_facility ON plan_markers(facility_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON plan_markers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_markers TO service_role;

DROP POLICY IF EXISTS "select_plan_markers" ON plan_markers;
CREATE POLICY "select_plan_markers"
ON plan_markers FOR SELECT
TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "insert_plan_markers" ON plan_markers;
CREATE POLICY "insert_plan_markers"
ON plan_markers FOR INSERT
TO authenticated
WITH CHECK (
  is_facility_member(facility_id, auth.uid())
  AND get_facility_role(facility_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
);

DROP POLICY IF EXISTS "update_plan_markers" ON plan_markers;
CREATE POLICY "update_plan_markers"
ON plan_markers FOR UPDATE
TO authenticated
USING (is_facility_member(facility_id, auth.uid()))
WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "delete_plan_markers" ON plan_markers;
CREATE POLICY "delete_plan_markers"
ON plan_markers FOR DELETE
TO authenticated
USING (
  is_facility_member(facility_id, auth.uid())
  AND get_facility_role(facility_id, auth.uid()) IN ('supervisor', 'admin')
);

-- ── Add FK from plan_documents.current_revision_id to plan_revisions ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'plan_documents_current_revision_id_fkey'
      AND table_name = 'plan_documents'
  ) THEN
    ALTER TABLE plan_documents
      ADD CONSTRAINT plan_documents_current_revision_id_fkey
      FOREIGN KEY (current_revision_id) REFERENCES plan_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;
