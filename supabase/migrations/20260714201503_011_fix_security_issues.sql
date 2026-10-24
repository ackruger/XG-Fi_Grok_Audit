/*
# Fix security issues: trades RLS, storage listing, and SECURITY DEFINER functions

## Changes

1. **trades table RLS** — Replace overly permissive INSERT/UPDATE/DELETE policies
   with membership-scoped policies. Only users who belong to at least one project
   can create/update/delete trades. SELECT remains open to all authenticated users
   since trades is a shared lookup table needed for asset assignment.

2. **Storage SELECT policies** — Remove broad SELECT policies on the public
   `avatars` and `photos` buckets. Public buckets serve files by direct URL
   without needing a SELECT policy; the existing policies only enabled file
   *listing* which exposes more metadata than intended.

3. **SECURITY DEFINER functions** — Revoke EXECUTE from `anon` on the three
   helper functions (`get_asset_project_id`, `get_project_role`, `is_project_member`).
   These are used internally by RLS policies (which run as DEFINER anyway) and
   should not be callable by unauthenticated users via the REST API.

## Security
- trades: INSERT/UPDATE/DELETE now require membership in at least one project.
- Storage: clients can no longer enumerate bucket contents.
- Functions: anon role can no longer invoke SECURITY DEFINER helpers.
*/

-- 1. Fix trades RLS policies

DROP POLICY IF EXISTS "trades_insert" ON trades;
CREATE POLICY "trades_insert" ON trades FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trades_update" ON trades;
CREATE POLICY "trades_update" ON trades FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trades_delete" ON trades;
CREATE POLICY "trades_delete" ON trades FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.user_id = auth.uid()
    )
  );

-- 2. Remove broad SELECT policies on public storage buckets

DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read photos" ON storage.objects;

-- 3. Revoke anon EXECUTE on SECURITY DEFINER functions

REVOKE EXECUTE ON FUNCTION public.get_asset_project_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_project_role(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) FROM anon;
