/*
# Xg-Fi Ver2: Import Training Mode and Preflight

## Purpose
Extends the existing safe import engine with Training mode (preflight only, no production
import). Adds a column to import batches to mark training-mode batches and ensures they
are isolated from production data through rollback-after-import semantics.

## Changes to Existing Tables

### `asset_import_batches`
- `is_training` (boolean, default false) — marks the batch as training-mode
- `preflight_summary` (jsonb, nullable) — stores preflight validation results before execution

## New Table: `import_preflight_results`
- `id` (uuid PK)
- `batch_id` (uuid FK → asset_import_batches, CASCADE) — nullable for pre-batch preflight
- `facility_id` (uuid FK → facilities, NOT NULL)
- `source_filename` (text NOT NULL)
- `fingerprint` (text NOT NULL)
- `total_rows` (int NOT NULL)
- `rows_add` (int NOT NULL default 0)
- `rows_update` (int NOT NULL default 0)
- `rows_hold` (int NOT NULL default 0)
- `rows_skip` (int NOT NULL default 0)
- `rows_conflict` (int NOT NULL default 0)
- `missing_asset_types` (text[], default '{}')
- `duplicate_detail_rows` (jsonb, default '[]')
- `placeholder_urls` (jsonb, default '[]') — columns where "URL Link" placeholder text was found instead of actual URLs
- `validation_errors` (jsonb, default '[]')
- `created_at` (timestamptz, default now())

## Security
- RLS on import_preflight_results, scoped through facility membership.
- SELECT: facility members can read.
- INSERT: contributor+ can create.
- UPDATE/DELETE: supervisor+ only (for correction/retry).
- The `is_training` column on asset_import_batches follows existing RLS for that table.

## Notes
1. Training-mode batches set is_training=true. The application wraps training imports in
   an automatic rollback after the import completes, so no production data is left behind.
2. Preflight results are stored before the import is executed, giving the user a preview
   of what will happen before committing.
3. A built-in harmless synthetic one-asset training fixture will be provided in the
   application code (not in this migration) — clearly labelled "Training".
4. The existing import rollback RPC (`rollback_import_batch`) works for training batches
   without modification since it already handles all batch types.
*/

-- Add columns to asset_import_batches
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'asset_import_batches' AND column_name = 'is_training') THEN
    ALTER TABLE asset_import_batches ADD COLUMN is_training boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'asset_import_batches' AND column_name = 'preflight_summary') THEN
    ALTER TABLE asset_import_batches ADD COLUMN preflight_summary jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_batches_training ON asset_import_batches(is_training) WHERE is_training = true;

-- ── import_preflight_results ──
CREATE TABLE IF NOT EXISTS import_preflight_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES asset_import_batches(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  fingerprint text NOT NULL,
  total_rows int NOT NULL,
  rows_add int NOT NULL DEFAULT 0,
  rows_update int NOT NULL DEFAULT 0,
  rows_hold int NOT NULL DEFAULT 0,
  rows_skip int NOT NULL DEFAULT 0,
  rows_conflict int NOT NULL DEFAULT 0,
  missing_asset_types text[] NOT NULL DEFAULT '{}',
  duplicate_detail_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  placeholder_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE import_preflight_results ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_preflight_facility ON import_preflight_results(facility_id);
CREATE INDEX IF NOT EXISTS idx_preflight_fingerprint ON import_preflight_results(fingerprint);

GRANT SELECT, INSERT ON import_preflight_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON import_preflight_results TO service_role;

DROP POLICY IF EXISTS "select_preflight_results" ON import_preflight_results;
CREATE POLICY "select_preflight_results"
ON import_preflight_results FOR SELECT
TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "insert_preflight_results" ON import_preflight_results;
CREATE POLICY "insert_preflight_results"
ON import_preflight_results FOR INSERT
TO authenticated
WITH CHECK (
  is_facility_member(facility_id, auth.uid())
  AND get_facility_role(facility_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
);
