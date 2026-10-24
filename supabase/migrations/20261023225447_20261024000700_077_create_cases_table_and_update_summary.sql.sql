/*
# Create cases table and update ai_facility_summary for live case totals

## Summary
Creates the missing `cases` table for formal tracked work (Observation, Deficiency,
Work Order/New) as required by Jay's requirement #5. The table is separate from
`issues` (which remains as a legacy table). Updates `ai_facility_summary` to query
the new `cases` table for live totals instead of returning hardcoded zeros.

## New Tables
- `cases` — formal tracked work records per asset
  - `id` uuid PK
  - `asset_id` uuid NOT NULL FK → assets
  - `facility_id` uuid NOT NULL FK → facilities
  - `case_type` text NOT NULL CHECK IN ('observation','deficiency','work_order')
  - `title` text NOT NULL
  - `description` text NOT NULL DEFAULT ''
  - `status` text NOT NULL DEFAULT 'open' CHECK IN ('open','in_progress','resolved','closed')
  - `priority` text NOT NULL DEFAULT 'medium' CHECK IN ('low','medium','high','critical')
  - `created_by` uuid NOT NULL DEFAULT auth.uid() FK → profiles
  - `assigned_to` uuid nullable FK → profiles
  - `resolved_at` timestamptz nullable
  - `closed_at` timestamptz nullable
  - `resolution_notes` text nullable
  - `deleted_at` timestamptz nullable (soft delete)
  - `created_at` timestamptz DEFAULT now()
  - `updated_at` timestamptz DEFAULT now()

## Modified Objects
- `case_source_links.case_id` — drop old FK to `issues`, add new FK to `cases`
- `ai_facility_summary` — updated to query `cases` table for live totals

## Security
- RLS enabled on `cases`
- CRUD policies scoped to facility membership via `is_facility_member` + `can_write_facility`
- SELECT: any facility member can read
- INSERT/UPDATE/DELETE: only writers (contributor+)
- Grants: SELECT/INSERT/UPDATE/DELETE to authenticated; SELECT to service_role
- `ai_facility_summary` updated, EXECUTE revoked from PUBLIC/anon, granted to authenticated+service_role

## Notes
1. Idempotent — uses IF NOT EXISTS and CREATE OR REPLACE.
2. The old `case_source_links.case_id` FK to `issues` is dropped and replaced with
   a FK to `cases`. Existing rows in `case_source_links` that reference `issues`
   will need manual migration if any exist (none expected in this clone).
3. `issues` table is NOT modified or dropped — it remains for backward compatibility.
*/

-- Create cases table
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  case_type text NOT NULL CHECK (case_type IN ('observation', 'deficiency', 'work_order')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  assigned_to uuid REFERENCES profiles(id),
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution_notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cases_asset_id ON cases(asset_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cases_facility_id ON cases(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(facility_id, status) WHERE deleted_at IS NULL;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON cases TO authenticated;
GRANT SELECT ON cases TO service_role;

-- RLS policies (4 separate per verb)
DROP POLICY IF EXISTS "select_cases" ON cases;
CREATE POLICY "select_cases" ON cases FOR SELECT TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "insert_cases" ON cases;
CREATE POLICY "insert_cases" ON cases FOR INSERT TO authenticated
WITH CHECK (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "update_cases" ON cases;
CREATE POLICY "update_cases" ON cases FOR UPDATE TO authenticated
USING (can_write_facility(facility_id, auth.uid()))
WITH CHECK (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "delete_cases" ON cases;
CREATE POLICY "delete_cases" ON cases FOR DELETE TO authenticated
USING (can_write_facility(facility_id, auth.uid()));

-- Update case_source_links FK: drop old FK to issues, add new FK to cases
ALTER TABLE case_source_links DROP CONSTRAINT IF EXISTS case_source_links_case_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_source_links_case_id_fkey'
      AND conrelid = 'case_source_links'::regclass
      AND confrelid = 'cases'::regclass
  ) THEN
    ALTER TABLE case_source_links
      ADD CONSTRAINT case_source_links_case_id_fkey
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update ai_facility_summary to query live cases table
CREATE OR REPLACE FUNCTION public.ai_facility_summary(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.get_facility_role(p_facility_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this facility' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'total_assets', (SELECT count(*) FROM assets WHERE facility_id = p_facility_id AND deleted_at IS NULL),
    'assets_by_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status, 'unknown') s, count(*) n FROM assets
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1) x), '{}'::jsonb),
    'distinct_types', (SELECT count(DISTINCT coalesce(equipment_type, '')) FROM assets WHERE facility_id = p_facility_id AND deleted_at IS NULL),
    'assets_by_type', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t, 'count', n) ORDER BY n DESC, t) FROM (
        SELECT coalesce(nullif(equipment_type, ''), 'Unspecified') t, count(*) n FROM assets
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30) x), '[]'::jsonb),
    'distinct_locations', (SELECT count(DISTINCT coalesce(l.building, '') || '/' || coalesce(l.floor, ''))
        FROM assets a LEFT JOIN locations l ON l.id = a.location_id WHERE a.facility_id = p_facility_id AND a.deleted_at IS NULL),
    'assets_by_location', coalesce((SELECT jsonb_agg(jsonb_build_object('name', loc, 'count', n, 'incomplete', inc) ORDER BY n DESC, loc) FROM (
        SELECT coalesce(nullif(concat_ws(' / ', nullif(l.building, ''), nullif(l.floor, '')), ''), 'No location') loc,
               count(*) n,
               count(*) FILTER (WHERE coalesce(a.status, '') NOT IN ('complete', 'accepted', 'closed')) inc
        FROM assets a LEFT JOIN locations l ON l.id = a.location_id
        WHERE a.facility_id = p_facility_id AND a.deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30) x), '[]'::jsonb),
    'total_cases', (SELECT count(*) FROM cases WHERE facility_id = p_facility_id AND deleted_at IS NULL),
    'open_cases', (SELECT count(*) FROM cases WHERE facility_id = p_facility_id AND deleted_at IS NULL AND status IN ('open', 'in_progress')),
    'cases_by_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status, 'unknown') s, count(*) n FROM cases
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1) x), '{}'::jsonb),
    'cases_by_priority', coalesce((SELECT jsonb_object_agg(p, n) FROM (
        SELECT coalesce(priority, 'unspecified') p, count(*) n FROM cases
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1) x), '{}'::jsonb),
    'total_issues', (SELECT count(*) FROM issues i JOIN assets a ON a.id = i.asset_id
        WHERE a.facility_id = p_facility_id AND i.deleted_at IS NULL),
    'open_issues', (SELECT count(*) FROM issues i JOIN assets a ON a.id = i.asset_id
        WHERE a.facility_id = p_facility_id AND i.deleted_at IS NULL AND coalesce(i.status, '') NOT IN ('closed', 'verified'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_facility_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_facility_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_facility_summary(uuid) TO service_role;