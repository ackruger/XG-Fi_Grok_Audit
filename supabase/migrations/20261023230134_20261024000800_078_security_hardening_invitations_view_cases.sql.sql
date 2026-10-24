/*
# Security hardening: revoke anon exec on invitation functions, fix checklist_run_summary, remove cases DELETE policy

## Summary
Addresses advisor findings:
1. Revoke PUBLIC/anon EXECUTE on invitation-related SECURITY DEFINER functions so only
   authenticated users can call them. These functions manipulate membership state and
   must not be callable without a valid session.
2. Set `checklist_run_summary` view to `security_invoker` so it enforces the calling
   user's RLS policies on its base tables (checklist_runs, checklist_items) instead of
   the view owner's privileges.
3. Remove the DELETE policy on `cases` so source/audit history cannot be physically
   erased. Cases are soft-deleted via UPDATE (setting `deleted_at`), preserving audit
   trails. REVOKE DELETE from authenticated on cases.

## Modified Objects
- `accept_pending_facility_invitations()` — REVOKE EXECUTE FROM PUBLIC, anon
- `remove_facility_member(uuid, uuid)` — REVOKE EXECUTE FROM PUBLIC, anon (if exists)
- `revoke_facility_invitation(uuid, uuid)` — REVOKE EXECUTE FROM PUBLIC, anon (if exists)
- `checklist_run_summary` view — ALTER to security_invoker
- `cases` table — DROP DELETE policy, REVOKE DELETE FROM authenticated

## Security Changes
- Invitation functions: only authenticated and service_role can EXECUTE
- checklist_run_summary: now enforces caller RLS on base tables
- cases: no physical DELETE allowed; soft-delete via UPDATE only

## Notes
1. Idempotent — REVOKE is safe to re-run.
2. The `accept_pending_facility_invitations` function is called from the frontend after
   sign-in, so it only needs authenticated access — not anon.
3. Removing DELETE on cases does NOT affect the DELETE policy on case_source_links
   (which remains for authorized users to remove source links if needed).
4. service_role bypasses RLS and retains DELETE for administrative cleanup if ever needed.
*/

-- 1. Revoke PUBLIC/anon EXECUTE on invitation SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.accept_pending_facility_invitations() FROM PUBLIC, anon;

DO $$
DECLARE
  fn_oid oid;
BEGIN
  -- remove_facility_member
  SELECT oid INTO fn_oid FROM pg_proc WHERE proname = 'remove_facility_member' AND pronamespace = 'public'::regnamespace;
  IF fn_oid IS NOT NULL THEN
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.remove_facility_member(uuid, uuid) FROM PUBLIC, anon');
  END IF;

  -- revoke_facility_invitation
  SELECT oid INTO fn_oid FROM pg_proc WHERE proname = 'revoke_facility_invitation' AND pronamespace = 'public'::regnamespace;
  IF fn_oid IS NOT NULL THEN
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.revoke_facility_invitation(uuid, uuid) FROM PUBLIC, anon');
  END IF;
END $$;

-- 2. Set checklist_run_summary to security_invoker
ALTER VIEW public.checklist_run_summary SET (security_invoker = true);

-- 3. Remove DELETE policy on cases — soft-delete only via UPDATE
DROP POLICY IF EXISTS "delete_cases" ON cases;
REVOKE DELETE ON cases FROM authenticated;