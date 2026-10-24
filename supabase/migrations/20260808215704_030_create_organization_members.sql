/*
# Create Organization Members Table

1. New Tables
   - `organization_members`
     - `id` (uuid, primary key)
     - `organization_id` (uuid, FK → organizations, ON DELETE CASCADE)
     - `user_id` (uuid, FK → auth.users, ON DELETE CASCADE)
     - `role` (text, CHECK admin/manager/member)
     - `joined_at` (timestamptz)
     - UNIQUE(organization_id, user_id)

2. Security
   - RLS enabled. Policies added after helper functions exist (migration 034).

3. Bootstrap Mechanism
   - The first user to sign up and have no organization membership becomes the
     org admin via a one-time bootstrap function.
   - A SECURITY DEFINER function `bootstrap_org_admin` checks:
     (a) The calling user is authenticated
     (b) The target organization has ZERO members
     (c) The calling user is not already a member
   - Only when all three conditions hold does it insert the caller as admin.
   - Once one admin exists, subsequent members must be added through the admin UI.
   - This avoids blindly making all existing users admins.

4. Notes
   - Organization roles: admin, manager, member.
   - admin = full control, manager = can manage facilities, member = read access.
*/

CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Bootstrap function: allows the first user to claim admin on an org with zero members.
-- SECURITY DEFINER so it can insert into org_members even before RLS policies exist.
CREATE OR REPLACE FUNCTION bootstrap_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_member_count int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check org has no members yet
  SELECT count(*) INTO v_member_count
  FROM organization_members
  WHERE organization_id = p_org_id;

  IF v_member_count > 0 THEN
    RAISE EXCEPTION 'Organization already has members — use the admin UI to add users';
  END IF;

  -- Insert the calling user as admin
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (p_org_id, v_user_id, 'admin')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN true;
END;
$$;

-- Allow authenticated users to call bootstrap, but the function body enforces safety
REVOKE ALL ON FUNCTION bootstrap_org_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bootstrap_org_admin(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION bootstrap_org_admin(uuid) FROM anon;
