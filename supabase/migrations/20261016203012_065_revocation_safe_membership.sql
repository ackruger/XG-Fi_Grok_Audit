/*
# Revocation-safe team membership

## Summary
Removing someone from a facility used to leave their accepted invitation behind, and older
acceptance logic re-created membership from accepted invitations on the next sign-in.
This migration makes removal durable and keeps existing roles intact on acceptance.

## 1. Modified tables
- `facility_invitations`
  - status may now also be `revoked`
  - new nullable columns `revoked_at` (timestamptz) and `revoked_by` (uuid -> auth.users)
- `organization_invitations`
  - status may now also be `revoked` (same new columns), for symmetry; nothing revokes them yet

## 2. Functions
- `accept_pending_facility_invitations()` (replaced)
  - processes ONLY invitations whose status is `pending` (accepted/revoked/declined never grant access)
  - never downgrades an existing facility role, organization role or organization default role;
    it only raises a role when the pending invitation grants a higher one
- `remove_facility_member(p_member_id uuid)` (new, SECURITY DEFINER, fixed search_path)
  - caller must be facility admin, or supervisor removing a non-admin; cannot remove yourself
  - in one transaction: locks the person's invitations for that facility, marks pending/accepted
    ones `revoked`, deletes the direct membership row
  - returns jsonb including any access the person still holds through organization-wide
    membership (intentional org-admin / all-facilities access is preserved, not silently removed)
- `revoke_facility_invitation(p_invitation_id uuid)` (new) marks a pending invitation `revoked`
  instead of deleting it, with the same authorization rule as the existing policies.

## 3. Security
- EXECUTE on the new/replaced functions is revoked from PUBLIC and anon and granted only to authenticated.
- No RLS policy is loosened.

## 4. Notes
1. Additive and idempotent; no rows are deleted or rewritten by this migration.
2. Lock order (invitations, then membership) matches the acceptance function to avoid deadlocks.
*/

ALTER TABLE public.facility_invitations ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.facility_invitations ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id);
ALTER TABLE public.organization_invitations ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.organization_invitations ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id);

ALTER TABLE public.facility_invitations DROP CONSTRAINT IF EXISTS facility_invitations_status_check;
ALTER TABLE public.facility_invitations ADD CONSTRAINT facility_invitations_status_check
  CHECK (status = ANY (ARRAY['pending','accepted','declined','revoked']));
ALTER TABLE public.organization_invitations DROP CONSTRAINT IF EXISTS organization_invitations_status_check;
ALTER TABLE public.organization_invitations ADD CONSTRAINT organization_invitations_status_check
  CHECK (status = ANY (ARRAY['pending','accepted','declined','revoked']));

CREATE INDEX IF NOT EXISTS idx_facility_invitations_facility_email
  ON public.facility_invitations (facility_id, lower(email));

CREATE OR REPLACE FUNCTION public.facility_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_role
    WHEN 'viewer' THEN 1
    WHEN 'contributor' THEN 2
    WHEN 'reviewer' THEN 3
    WHEN 'supervisor' THEN 4
    WHEN 'admin' THEN 5
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.accept_pending_facility_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_inv record;
  v_count integer := 0;
  v_org_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_user_id;
  v_email := COALESCE(NULLIF(v_email, ''), lower(COALESCE(auth.jwt() ->> 'email', '')));
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Authenticated user has no email address';
  END IF;

  FOR v_inv IN
    SELECT oi.id, oi.organization_id, oi.facility_role
    FROM organization_invitations oi
    WHERE lower(oi.email) = v_email AND oi.status = 'pending'
    FOR UPDATE
  LOOP
    INSERT INTO organization_members AS om (organization_id, user_id, role, all_facilities, default_facility_role)
    VALUES (
      v_inv.organization_id, v_user_id,
      CASE WHEN v_inv.facility_role = 'admin' THEN 'admin' ELSE 'member' END,
      true, v_inv.facility_role
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = CASE WHEN om.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin' ELSE om.role END,
      default_facility_role = CASE
        WHEN om.all_facilities
          AND facility_role_rank(om.default_facility_role) >= facility_role_rank(EXCLUDED.default_facility_role)
        THEN om.default_facility_role
        ELSE EXCLUDED.default_facility_role
      END,
      all_facilities = true;

    UPDATE organization_invitations
    SET status = 'accepted', accepted_at = COALESCE(accepted_at, now())
    WHERE id = v_inv.id;
    v_count := v_count + 1;
  END LOOP;

  FOR v_inv IN
    SELECT fi.id, fi.facility_id, fi.role
    FROM facility_invitations fi
    WHERE lower(fi.email) = v_email AND fi.status = 'pending'
    FOR UPDATE
  LOOP
    SELECT organization_id INTO v_org_id FROM facilities WHERE id = v_inv.facility_id;
    IF v_org_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO facility_members AS fm (facility_id, user_id, role)
    VALUES (v_inv.facility_id, v_user_id, v_inv.role)
    ON CONFLICT (facility_id, user_id) DO UPDATE SET
      role = CASE
        WHEN facility_role_rank(EXCLUDED.role) > facility_role_rank(fm.role) THEN EXCLUDED.role
        ELSE fm.role
      END;

    UPDATE facility_invitations
    SET status = 'accepted', accepted_at = COALESCE(accepted_at, now())
    WHERE id = v_inv.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_facility_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_facility_id uuid;
  v_target uuid;
  v_target_role text;
  v_caller_role text;
  v_email text;
  v_revoked integer := 0;
  v_remaining text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT facility_id, user_id INTO v_facility_id, v_target
  FROM facility_members WHERE id = p_member_id;
  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002';
  END IF;

  v_caller_role := get_facility_role(v_facility_id, v_caller);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'Not authorized to remove members from this facility' USING ERRCODE = '42501';
  END IF;
  IF v_target = v_caller THEN
    RAISE EXCEPTION 'You cannot remove yourself' USING ERRCODE = '42501';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_target;
  IF v_email IS NULL THEN
    SELECT lower(email) INTO v_email FROM profiles WHERE id = v_target;
  END IF;

  PERFORM 1 FROM facility_invitations
  WHERE facility_id = v_facility_id AND lower(email) = v_email
  FOR UPDATE;

  SELECT role INTO v_target_role
  FROM facility_members
  WHERE id = p_member_id AND facility_id = v_facility_id AND user_id = v_target
  FOR UPDATE;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_caller_role <> 'admin' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Only admins can remove an admin' USING ERRCODE = '42501';
  END IF;

  IF v_email IS NOT NULL THEN
    UPDATE facility_invitations
    SET status = 'revoked', revoked_at = now(), revoked_by = v_caller
    WHERE facility_id = v_facility_id
      AND lower(email) = v_email
      AND status IN ('pending', 'accepted');
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  END IF;

  DELETE FROM facility_members WHERE id = p_member_id;

  v_remaining := get_facility_role(v_facility_id, v_target);

  RETURN jsonb_build_object(
    'removed', true,
    'revoked_invitations', v_revoked,
    'remaining_org_role', v_remaining
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_facility_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inv record;
  v_caller_role text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, facility_id, role, status INTO v_inv
  FROM facility_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  v_caller_role := get_facility_role(v_inv.facility_id, v_caller);
  IF NOT (v_caller_role = 'admin' OR (v_caller_role = 'supervisor' AND v_inv.role <> 'admin')) THEN
    RAISE EXCEPTION 'Not authorized to revoke this invitation' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RETURN false;
  END IF;

  UPDATE facility_invitations
  SET status = 'revoked', revoked_at = now(), revoked_by = v_caller
  WHERE id = p_invitation_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.facility_role_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_role_rank(text) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_pending_facility_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_pending_facility_invitations() TO authenticated;
REVOKE ALL ON FUNCTION public.remove_facility_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_facility_member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_facility_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_facility_invitation(uuid) TO authenticated;
