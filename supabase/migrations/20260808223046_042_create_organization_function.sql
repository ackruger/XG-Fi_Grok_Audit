/*
# Create Organization Atomically with Admin Membership

1. New Functions
   - `create_organization(p_name text, p_description text DEFAULT NULL)` → returns the new org row as JSON
     - SECURITY DEFINER: bypasses RLS to insert org + org member atomically
     - Creates the organization record
     - Adds the calling user as organization admin in organization_members
     - Returns the new organization data
     - Rejects unauthenticated callers

2. Policy Changes
   - Tighten org_insert: no longer allows raw INSERT from the client (WITH CHECK (false))
   - All org creation must go through create_organization() function
   - This prevents creating orgs without a corresponding admin membership

3. Notes
   - The function is atomic: either both the org and the admin membership are created, or neither
   - Authenticated-only: anon cannot call this function
   - The old bootstrap_org_admin() remains for the initial Novus org setup
*/

-- Create the atomic organization creation function
CREATE OR REPLACE FUNCTION create_organization(p_name text, p_description text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_org json;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  -- Create the organization
  INSERT INTO organizations (name, description)
  VALUES (trim(p_name), nullif(trim(p_description), ''))
  RETURNING id INTO v_org_id;

  -- Add creator as admin
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'admin');

  -- Return the full org record
  SELECT row_to_json(o) INTO v_org
  FROM organizations o WHERE o.id = v_org_id;

  RETURN v_org;
END;
$$;

REVOKE ALL ON FUNCTION create_organization(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION create_organization(text, text) FROM anon;

-- Tighten the direct INSERT policy: org creation must go through the function
DROP POLICY IF EXISTS "org_insert" ON organizations;
CREATE POLICY "org_insert" ON organizations FOR INSERT TO authenticated
  WITH CHECK (false);
