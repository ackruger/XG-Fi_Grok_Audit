/*
# Restore facility invitation cancellation

## 1. Changes
- Add revoked_at and revoked_by to facility_invitations to record when and by whom an invitation was canceled.
- Extend the existing status check to allow revoked invitations without deleting records.
- Restore revoke_facility_invitation(p_invitation_id uuid), matching the Team page request.

## 2. Security
- Only signed-in facility admins, or supervisors canceling non-admin invitations, may cancel.
- Check the caller from the session; deny missing roles explicitly.
- Lock the invitation so cancellation cannot race with acceptance.
- Restrict function execution to authenticated users and fix the search path. Existing table policies remain unchanged.

## 3. Notes
1. Existing invitations and memberships are preserved.
2. Already accepted or canceled invitations return false and do not change membership.
3. All changes are safe to reapply.
*/
ALTER TABLE public.facility_invitations ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.facility_invitations ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id);
ALTER TABLE public.facility_invitations DROP CONSTRAINT IF EXISTS facility_invitations_status_check;
ALTER TABLE public.facility_invitations ADD CONSTRAINT facility_invitations_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
CREATE OR REPLACE FUNCTION public.revoke_facility_invitation(p_invitation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inv record;
  v_role text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT id, facility_id, role, status INTO v_inv FROM public.facility_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_role := public.get_facility_role(v_inv.facility_id, v_caller);
  IF v_role IS NULL OR NOT (v_role = 'admin' OR (v_role = 'supervisor' AND v_inv.role <> 'admin')) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'pending' THEN RETURN false; END IF;
  UPDATE public.facility_invitations SET status = 'revoked', revoked_at = now(), revoked_by = v_caller WHERE id = p_invitation_id AND status = 'pending';
  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_facility_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_facility_invitation(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';