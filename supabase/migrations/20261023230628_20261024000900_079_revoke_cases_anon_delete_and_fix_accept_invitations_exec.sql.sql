/*
# Security hardening: revoke anon DELETE on cases and re-apply EXECUTE revoke on accept_pending_facility_invitations

1. Purpose
   Migration 078 attempted to REVOKE EXECUTE on accept_pending_facility_invitations
   and remove DELETE from cases. The advisor still reports:
   - anon can execute accept_pending_facility_invitations (SECURITY DEFINER)
   - cases table still has DELETE granted to anon role

   This migration re-applies both revokes idempotently to close those gaps.

2. Changes
   - REVOKE DELETE ON cases FROM anon (the delete_cases policy was already dropped in 078,
     but the table-level DELETE grant on anon remained).
   - REVOKE EXECUTE ON FUNCTION accept_pending_facility_invitations() FROM PUBLIC, anon.

3. Notes
   - No data is modified or deleted.
   - No tables, columns, or policies are created or dropped.
   - The function remains callable by authenticated users (default EXECUTE grant to authenticated).
   - cases table retains SELECT/INSERT/UPDATE on authenticated, SELECT on service_role.
*/

REVOKE DELETE ON public.cases FROM anon;

REVOKE EXECUTE ON FUNCTION public.accept_pending_facility_invitations() FROM PUBLIC, anon;
