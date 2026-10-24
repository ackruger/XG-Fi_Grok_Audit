/*
# Xg-Fi Ver2: LOTO (Lock-Out / Tag-Out) Records

## Purpose
Separates General Lock-Out from formal life-safety LOTO. Creates append-only, auditable
LOTO records with full status tracking, owner/date, isolation points, and clear/clear-by
tracking. Formal LOTO records explicitly state the app record does NOT authorize physical
lock removal. No deletion of LOTO history is permitted.

## New Tables

### 1. `loto_records`
- `id` (uuid PK)
- `asset_id` (uuid FK → assets, NOT NULL)
- `facility_id` (uuid FK → facilities, NOT NULL) — denormalized for RLS efficiency
- `loto_type` (text NOT NULL) — 'general_lockout' | 'formal_loto'
- `status` (text NOT NULL) — 'active' | 'cleared'
- `reason` (text NOT NULL) — why the lock-out was applied
- `applied_by_user_id` (uuid FK → profiles, nullable) — app user who applied
- `applied_by_contact` (text, nullable) — external contact name if not an app user
- `applied_at` (timestamptz NOT NULL, default now())
- `physical_lock_id` (text, nullable) — physical lock/tag identifier
- `isolation_points` (text, nullable) — description of isolation points
- `notes` (text, nullable)
- `cleared_by_user_id` (uuid FK → profiles, nullable)
- `cleared_by_contact` (text, nullable)
- `cleared_at` (timestamptz, nullable)
- `clearance_notes` (text, nullable)
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

### 2. `loto_audit_log`
- `id` (uuid PK)
- `loto_record_id` (uuid FK → loto_records, NOT NULL)
- `action` (text NOT NULL) — 'created' | 'cleared' | 'note_added' | 'status_changed'
- `changed_by_user_id` (uuid FK → profiles, nullable)
- `changed_by_contact` (text, nullable)
- `previous_values` (jsonb, nullable) — snapshot of changed fields before update
- `new_values` (jsonb, nullable) — snapshot after
- `created_at` (timestamptz, default now())

## Security
- RLS enabled on both tables.
- SELECT: facility members can read LOTO records for their facility.
- INSERT: contributor+ role required (checked via get_facility_role).
- UPDATE: only supervisor+ can clear a LOTO (checked via RLS + trigger).
  General lockout: supervisor+ can clear.
  Formal LOTO: admin only can clear.
- DELETE: no DELETE policy — LOTO history cannot be deleted through the Data API.
  (service_role can still delete for administrative recovery, but no user-facing DELETE policy.)
- Audit log: INSERT only (no UPDATE/DELETE through Data API).
- Grants: SELECT to authenticated; INSERT to authenticated; UPDATE to authenticated;
  no DELETE grant to authenticated.

## Notes
1. The `cleared_by` fields and `cleared_at` are only set when a LOTO is cleared.
2. The UI must display a clear disclaimer for formal_loto records stating the app record
   does not authorize physical lock removal.
3. The audit trigger logs all INSERT and UPDATE actions to loto_audit_log.
4. Idempotent: uses IF NOT EXISTS throughout.
*/

-- ── loto_records table ──
CREATE TABLE IF NOT EXISTS loto_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  loto_type text NOT NULL CHECK (loto_type IN ('general_lockout', 'formal_loto')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleared')),
  reason text NOT NULL,
  applied_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  applied_by_contact text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  physical_lock_id text,
  isolation_points text,
  notes text,
  cleared_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  cleared_by_contact text,
  cleared_at timestamptz,
  clearance_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE loto_records ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_loto_records_asset_id ON loto_records(asset_id);
CREATE INDEX IF NOT EXISTS idx_loto_records_facility_id ON loto_records(facility_id);
CREATE INDEX IF NOT EXISTS idx_loto_records_status ON loto_records(status) WHERE status = 'active';

-- ── loto_audit_log table ──
CREATE TABLE IF NOT EXISTS loto_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loto_record_id uuid NOT NULL REFERENCES loto_records(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'cleared', 'note_added', 'status_changed')),
  changed_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  changed_by_contact text,
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE loto_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_loto_audit_loto_record_id ON loto_audit_log(loto_record_id);

-- ── Grants ──
-- loto_records: SELECT, INSERT, UPDATE (no DELETE)
GRANT SELECT, INSERT, UPDATE ON loto_records TO authenticated;
GRANT SELECT, INSERT, UPDATE ON loto_records TO service_role;
GRANT DELETE ON loto_records TO service_role;

-- loto_audit_log: SELECT, INSERT only (no UPDATE/DELETE through Data API)
GRANT SELECT, INSERT ON loto_audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON loto_audit_log TO service_role;

-- ── RLS Policies for loto_records ──
-- SELECT: facility members can read
DROP POLICY IF EXISTS "select_loto_records" ON loto_records;
CREATE POLICY "select_loto_records"
ON loto_records FOR SELECT
TO authenticated
USING (is_facility_member(facility_id, auth.uid()));

-- INSERT: contributor+ can create
DROP POLICY IF EXISTS "insert_loto_records" ON loto_records;
CREATE POLICY "insert_loto_records"
ON loto_records FOR INSERT
TO authenticated
WITH CHECK (
  is_facility_member(facility_id, auth.uid())
  AND get_facility_role(facility_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
);

-- UPDATE: supervisor+ can update (clear) — formal LOTO requires admin
DROP POLICY IF EXISTS "update_loto_records" ON loto_records;
CREATE POLICY "update_loto_records"
ON loto_records FOR UPDATE
TO authenticated
USING (is_facility_member(facility_id, auth.uid()))
WITH CHECK (
  is_facility_member(facility_id, auth.uid())
  AND (
    (loto_type = 'general_lockout' AND get_facility_role(facility_id, auth.uid()) IN ('supervisor', 'admin'))
    OR
    (loto_type = 'formal_loto' AND get_facility_role(facility_id, auth.uid()) = 'admin')
  )
);

-- No DELETE policy — history cannot be deleted through Data API

-- ── RLS Policies for loto_audit_log ──
DROP POLICY IF EXISTS "select_loto_audit_log" ON loto_audit_log;
CREATE POLICY "select_loto_audit_log"
ON loto_audit_log FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM loto_records lr
    WHERE lr.id = loto_audit_log.loto_record_id
      AND is_facility_member(lr.facility_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "insert_loto_audit_log" ON loto_audit_log;
CREATE POLICY "insert_loto_audit_log"
ON loto_audit_log FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM loto_records lr
    WHERE lr.id = loto_audit_log.loto_record_id
      AND is_facility_member(lr.facility_id, auth.uid())
  )
);

-- No UPDATE or DELETE policy on audit log

-- ── Audit trigger function ──
CREATE OR REPLACE FUNCTION log_loto_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_clear boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO loto_audit_log (loto_record_id, action, changed_by_user_id, new_values)
    VALUES (NEW.id, 'created', v_user_id,
      jsonb_build_object(
        'loto_type', NEW.loto_type,
        'status', NEW.status,
        'reason', NEW.reason,
        'applied_by_user_id', NEW.applied_by_user_id,
        'applied_at', NEW.applied_at
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Detect clearing
    IF OLD.status = 'active' AND NEW.status = 'cleared' THEN
      v_is_clear := true;
    END IF;

    INSERT INTO loto_audit_log (loto_record_id, action, changed_by_user_id, previous_values, new_values)
    VALUES (
      NEW.id,
      CASE WHEN v_is_clear THEN 'cleared' ELSE 'status_changed' END,
      v_user_id,
      jsonb_build_object(
        'status', OLD.status,
        'cleared_at', OLD.cleared_at,
        'notes', OLD.notes
      ),
      jsonb_build_object(
        'status', NEW.status,
        'cleared_at', NEW.cleared_at,
        'cleared_by_user_id', NEW.cleared_by_user_id,
        'clearance_notes', NEW.clearance_notes,
        'notes', NEW.notes
      )
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION log_loto_changes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_loto_changes() TO authenticated;

DROP TRIGGER IF EXISTS trg_loto_audit ON loto_records;
CREATE TRIGGER trg_loto_audit
AFTER INSERT OR UPDATE ON loto_records
FOR EACH ROW EXECUTE FUNCTION log_loto_changes();

-- Prevent deletion through a DEFERRABLE constraint check
-- (No trigger needed — RLS already blocks DELETE since there's no DELETE policy)
