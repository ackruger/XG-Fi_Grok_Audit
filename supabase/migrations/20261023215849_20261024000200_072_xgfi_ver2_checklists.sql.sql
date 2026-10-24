/*
# Xg-Fi Ver2: Checklist Templates and Runs

## Purpose
Supports reusable checklist templates and per-asset checklist runs/items so that dashboard
completion can derive from a selected checklist focus (rough-in, startup, commissioning)
rather than a single overloaded asset status. Keeps "blocked" and "deficient" separate.

## New Tables

### 1. `checklist_templates`
- `id` (uuid PK)
- `organization_id` (uuid FK → organizations, NOT NULL) — templates are org-scoped
- `name` (text NOT NULL) — e.g. "Rough-In Checklist"
- `focus` (text NOT NULL) — 'rough_in' | 'startup' | 'commissioning' | 'general'
- `description` (text, nullable)
- `is_active` (boolean, default true)
- `created_at`, `updated_at`

### 2. `checklist_template_items`
- `id` (uuid PK)
- `template_id` (uuid FK → checklist_templates, CASCADE)
- `label` (text NOT NULL)
- `sort_order` (int, default 0)
- `is_required` (boolean, default false)
- `created_at`

### 3. `checklist_runs`
- `id` (uuid PK)
- `asset_id` (uuid FK → assets, CASCADE)
- `facility_id` (uuid FK → facilities, NOT NULL) — denormalized for RLS
- `template_id` (uuid FK → checklist_templates, nullable) — null = ad-hoc
- `focus` (text NOT NULL) — same enum as templates
- `name` (text NOT NULL)
- `status` (text NOT NULL default 'in_progress') — 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'deficient'
- `created_by` (uuid FK → profiles)
- `completed_at` (timestamptz, nullable)
- `created_at`, `updated_at`

### 4. `checklist_items`
- `id` (uuid PK)
- `run_id` (uuid FK → checklist_runs, CASCADE)
- `label` (text NOT NULL)
- `sort_order` (int, default 0)
- `state` (text NOT NULL default 'pending') — 'pending' | 'passed' | 'failed' | 'blocked' | 'skipped'
- `is_required` (boolean, default false)
- `notes` (text, nullable)
- `completed_by` (uuid FK → profiles, nullable)
- `completed_at` (timestamptz, nullable)
- `created_at`, `updated_at`

### 5. `checklist_run_summary` (VIEW)
- Computes per-run completion stats: total, passed, failed, blocked, pending, completion_pct

## Security
- RLS on all tables, scoped through facility membership.
- Templates: org members can read; org managers+ can create/edit.
- Runs and items: facility members can read; contributor+ can create/edit.
- Grants: SELECT to authenticated on all; INSERT/UPDATE where appropriate.

## Notes
1. Blocked and deficient are separate states in both runs and items.
2. Dashboard completion will use the checklist run summary view, filtered by the asset's
   `checklist_focus` field added in migration 070.
3. Existing dashboard behavior is preserved — it still reads `assets.status` until
   checklist data exists, then the UI falls back to the old calculation.
*/

-- ── checklist_templates ──
CREATE TABLE IF NOT EXISTS checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  focus text NOT NULL CHECK (focus IN ('rough_in', 'startup', 'commissioning', 'general')),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_checklist_templates_org ON checklist_templates(organization_id);

GRANT SELECT, INSERT, UPDATE ON checklist_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_templates TO service_role;

DROP POLICY IF EXISTS "select_checklist_templates" ON checklist_templates;
CREATE POLICY "select_checklist_templates"
ON checklist_templates FOR SELECT
TO authenticated
USING (is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "insert_checklist_templates" ON checklist_templates;
CREATE POLICY "insert_checklist_templates"
ON checklist_templates FOR INSERT
TO authenticated
WITH CHECK (
  is_org_member(organization_id, auth.uid())
  AND get_org_role(organization_id, auth.uid()) IN ('admin', 'manager')
);

DROP POLICY IF EXISTS "update_checklist_templates" ON checklist_templates;
CREATE POLICY "update_checklist_templates"
ON checklist_templates FOR UPDATE
TO authenticated
USING (
  is_org_member(organization_id, auth.uid())
  AND get_org_role(organization_id, auth.uid()) IN ('admin', 'manager')
)
WITH CHECK (
  is_org_member(organization_id, auth.uid())
  AND get_org_role(organization_id, auth.uid()) IN ('admin', 'manager')
);

-- ── checklist_template_items ──
CREATE TABLE IF NOT EXISTS checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template ON checklist_template_items(template_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_template_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_template_items TO service_role;

DROP POLICY IF EXISTS "select_checklist_template_items" ON checklist_template_items;
CREATE POLICY "select_checklist_template_items"
ON checklist_template_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_templates ct
    WHERE ct.id = checklist_template_items.template_id
      AND is_org_member(ct.organization_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "insert_checklist_template_items" ON checklist_template_items;
CREATE POLICY "insert_checklist_template_items"
ON checklist_template_items FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM checklist_templates ct
    WHERE ct.id = checklist_template_items.template_id
      AND is_org_member(ct.organization_id, auth.uid())
      AND get_org_role(ct.organization_id, auth.uid()) IN ('admin', 'manager')
  )
);

DROP POLICY IF EXISTS "update_checklist_template_items" ON checklist_template_items;
CREATE POLICY "update_checklist_template_items"
ON checklist_template_items FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_templates ct
    WHERE ct.id = checklist_template_items.template_id
      AND is_org_member(ct.organization_id, auth.uid())
      AND get_org_role(ct.organization_id, auth.uid()) IN ('admin', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM checklist_templates ct
    WHERE ct.id = checklist_template_items.template_id
      AND is_org_member(ct.organization_id, auth.uid())
      AND get_org_role(ct.organization_id, auth.uid()) IN ('admin', 'manager')
  )
);

DROP POLICY IF EXISTS "delete_checklist_template_items" ON checklist_template_items;
CREATE POLICY "delete_checklist_template_items"
ON checklist_template_items FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_templates ct
    WHERE ct.id = checklist_template_items.template_id
      AND is_org_member(ct.organization_id, auth.uid())
      AND get_org_role(ct.organization_id, auth.uid()) IN ('admin', 'manager')
  )
);

-- ── checklist_runs ──
CREATE TABLE IF NOT EXISTS checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  template_id uuid REFERENCES checklist_templates(id) ON DELETE SET NULL,
  focus text NOT NULL CHECK (focus IN ('rough_in', 'startup', 'commissioning', 'general')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('not_started', 'in_progress', 'complete', 'blocked', 'deficient')),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checklist_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_checklist_runs_asset ON checklist_runs(asset_id);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_facility ON checklist_runs(facility_id);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_focus ON checklist_runs(focus) WHERE completed_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON checklist_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_runs TO service_role;

DROP POLICY IF EXISTS "select_checklist_runs" ON checklist_runs;
CREATE POLICY "select_checklist_runs"
ON checklist_runs FOR SELECT
TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "insert_checklist_runs" ON checklist_runs;
CREATE POLICY "insert_checklist_runs"
ON checklist_runs FOR INSERT
TO authenticated
WITH CHECK (
  is_facility_member(facility_id, auth.uid())
  AND get_facility_role(facility_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
);

DROP POLICY IF EXISTS "update_checklist_runs" ON checklist_runs;
CREATE POLICY "update_checklist_runs"
ON checklist_runs FOR UPDATE
TO authenticated
USING (is_facility_member(facility_id, auth.uid()))
WITH CHECK (is_facility_member(facility_id, auth.uid()));

-- ── checklist_items ──
CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES checklist_runs(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'passed', 'failed', 'blocked', 'skipped')),
  is_required boolean NOT NULL DEFAULT false,
  notes text,
  completed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_checklist_items_run ON checklist_items(run_id);

GRANT SELECT, INSERT, UPDATE ON checklist_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_items TO service_role;

DROP POLICY IF EXISTS "select_checklist_items" ON checklist_items;
CREATE POLICY "select_checklist_items"
ON checklist_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_runs cr
    WHERE cr.id = checklist_items.run_id
      AND is_facility_member(cr.facility_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "insert_checklist_items" ON checklist_items;
CREATE POLICY "insert_checklist_items"
ON checklist_items FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM checklist_runs cr
    WHERE cr.id = checklist_items.run_id
      AND is_facility_member(cr.facility_id, auth.uid())
      AND get_facility_role(cr.facility_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  )
);

DROP POLICY IF EXISTS "update_checklist_items" ON checklist_items;
CREATE POLICY "update_checklist_items"
ON checklist_items FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_runs cr
    WHERE cr.id = checklist_items.run_id
      AND is_facility_member(cr.facility_id, auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM checklist_runs cr
    WHERE cr.id = checklist_items.run_id
      AND is_facility_member(cr.facility_id, auth.uid())
  )
);

-- ── Auto-update checklist_runs status based on items ──
CREATE OR REPLACE FUNCTION update_checklist_run_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_total int;
  v_passed int;
  v_failed int;
  v_blocked int;
  v_pending int;
  v_required_total int;
  v_required_passed int;
  v_new_status text;
BEGIN
  v_run_id := COALESCE(NEW.run_id, OLD.run_id);

  SELECT COUNT(*), COUNT(*) FILTER (WHERE state = 'passed'),
         COUNT(*) FILTER (WHERE state = 'failed'),
         COUNT(*) FILTER (WHERE state = 'blocked'),
         COUNT(*) FILTER (WHERE state = 'pending')
  INTO v_total, v_passed, v_failed, v_blocked, v_pending
  FROM checklist_items WHERE run_id = v_run_id;

  IF v_blocked > 0 THEN
    v_new_status := 'blocked';
  ELSIF v_failed > 0 THEN
    v_new_status := 'deficient';
  ELSIF v_pending = 0 AND v_total > 0 THEN
    v_new_status := 'complete';
  ELSE
    v_new_status := 'in_progress';
  END IF;

  UPDATE checklist_runs SET status = v_new_status, updated_at = now(),
    completed_at = CASE WHEN v_new_status = 'complete' THEN now() ELSE NULL END
  WHERE id = v_run_id AND status <> v_new_status;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION update_checklist_run_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_checklist_run_status() TO authenticated;

DROP TRIGGER IF EXISTS trg_checklist_item_change ON checklist_items;
CREATE TRIGGER trg_checklist_item_change
AFTER INSERT OR UPDATE OR DELETE ON checklist_items
FOR EACH ROW EXECUTE FUNCTION update_checklist_run_status();

-- ── Checklist run summary view ──
CREATE OR REPLACE VIEW checklist_run_summary AS
SELECT
  cr.id AS run_id,
  cr.asset_id,
  cr.facility_id,
  cr.focus,
  cr.status AS run_status,
  COUNT(ci.id) AS total_items,
  COUNT(ci.id) FILTER (WHERE ci.state = 'passed') AS passed_items,
  COUNT(ci.id) FILTER (WHERE ci.state = 'failed') AS failed_items,
  COUNT(ci.id) FILTER (WHERE ci.state = 'blocked') AS blocked_items,
  COUNT(ci.id) FILTER (WHERE ci.state = 'pending') AS pending_items,
  CASE
    WHEN COUNT(ci.id) = 0 THEN 0
    ELSE ROUND(
      COUNT(ci.id) FILTER (WHERE ci.state = 'passed')::numeric / COUNT(ci.id) * 100, 1
    )
  END AS completion_pct
FROM checklist_runs cr
LEFT JOIN checklist_items ci ON ci.run_id = cr.id
GROUP BY cr.id, cr.asset_id, cr.facility_id, cr.focus, cr.status;

GRANT SELECT ON checklist_run_summary TO authenticated;
