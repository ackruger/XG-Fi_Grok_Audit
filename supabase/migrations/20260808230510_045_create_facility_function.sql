/*
# Create SECURITY DEFINER function for facility creation

## Summary
Creates a `create_facility()` function that atomically:
1. Verifies the caller is an admin or manager of the target organization
2. Inserts the new facility row
3. Inserts the caller as a facility_members admin
4. Returns the new facility row as JSON

This bypasses the chicken-and-egg RLS problem where:
- The INSERT policy on `facilities` requires org membership (works fine)
- But the SELECT policy on `facilities` requires `is_facility_member()`, which
  checks `facility_members` — a table that has no row yet for the new facility
- PostgREST's `.insert().select()` requires BOTH INSERT WITH CHECK and SELECT
  USING to pass on the returned row, causing a 403 even though the INSERT itself
  would succeed

## Security
- SECURITY DEFINER: runs as the function owner (postgres), bypassing RLS
- Authorization check: verifies `get_org_role()` returns 'admin' or 'manager'
  before proceeding — unauthorized callers get an explicit error
- EXECUTE granted only to `authenticated` role
- search_path locked to 'public'
- The caller's `auth.uid()` is used for both the authorization check and the
  facility_members row, so no privilege escalation is possible

## Notes
1. This mirrors the existing `create_organization()` pattern.
2. The function is idempotent (CREATE OR REPLACE).
3. Org admins get implicit facility access via `is_facility_member()` and
   `get_facility_role()`, so the explicit `facility_members` row is for
   non-org-admin facility managers/members added later.
*/

CREATE OR REPLACE FUNCTION create_facility(
  p_name text,
  p_organization_id uuid,
  p_code text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller_role text;
  v_facility_id uuid;
  v_facility jsonb;
BEGIN
  -- Verify caller is org admin or manager
  v_caller_role := get_org_role(p_organization_id, auth.uid());
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Permission denied: you must be an organization admin or manager to create a facility';
  END IF;

  -- Insert the facility
  INSERT INTO facilities (name, organization_id, code, description)
  VALUES (p_name, p_organization_id, p_code, p_description)
  RETURNING id INTO v_facility_id;

  -- Add caller as facility admin
  INSERT INTO facility_members (facility_id, user_id, role)
  VALUES (v_facility_id, auth.uid(), 'admin');

  -- Return the full facility row as JSON
  SELECT to_jsonb(f) INTO v_facility
  FROM facilities f
  WHERE f.id = v_facility_id;

  RETURN v_facility;
END;
$$;

-- Only authenticated users can call this
REVOKE EXECUTE ON FUNCTION create_facility(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_facility(text, uuid, text, text) TO authenticated;
