/*
# Create Facility/Organization Security Helper Functions

1. New Functions (all SECURITY DEFINER, search_path = public)
   - `is_org_member(p_org_id uuid, p_user_id uuid)` → boolean
   - `get_org_role(p_org_id uuid, p_user_id uuid)` → text
   - `is_facility_member(p_facility_id uuid, p_user_id uuid)` → boolean
     — returns true if user is a direct facility member OR an org admin for the facility's org
   - `get_facility_role(p_facility_id uuid, p_user_id uuid)` → text
     — returns the facility role, or 'admin' if the user is an org admin

2. Security
   - EXECUTE revoked from anon on all functions.
   - Only authenticated users can call these.

3. Notes
   - Org admins have implicit admin-level access to all facilities in their org.
   - This is deliberate and documented: org admin = facility admin for RLS purposes.
   - get_asset_facility_id is deferred to migration 037 (after facility_id column exists on assets).
*/

-- Organization membership check
CREATE OR REPLACE FUNCTION is_org_member(p_org_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_org_id
      AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION is_org_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_org_member(uuid, uuid) TO authenticated;

-- Organization role lookup
CREATE OR REPLACE FUNCTION get_org_role(p_org_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM organization_members
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_org_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_org_role(uuid, uuid) TO authenticated;

-- Facility membership check (includes org admin implicit access)
CREATE OR REPLACE FUNCTION is_facility_member(p_facility_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_id = p_facility_id
      AND user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM facilities f
    JOIN organization_members om ON om.organization_id = f.organization_id
    WHERE f.id = p_facility_id
      AND om.user_id = p_user_id
      AND om.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION is_facility_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_facility_member(uuid, uuid) TO authenticated;

-- Facility role lookup (org admin → 'admin')
CREATE OR REPLACE FUNCTION get_facility_role(p_facility_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM facility_members
     WHERE facility_id = p_facility_id AND user_id = p_user_id),
    (SELECT 'admin' FROM facilities f
     JOIN organization_members om ON om.organization_id = f.organization_id
     WHERE f.id = p_facility_id
       AND om.user_id = p_user_id
       AND om.role = 'admin')
  );
$$;

REVOKE ALL ON FUNCTION get_facility_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_facility_role(uuid, uuid) TO authenticated;
