/*
# Fix infinite recursion in project_members RLS policies

The pm_select policy referenced project_members itself, causing infinite recursion.
The projects_select policy also queried project_members which triggered the same loop.

## Fix
- pm_select: use simple user_id = auth.uid() check (user can see their own memberships)
- pm_insert: allow if user_id = auth.uid() (self-join) -- admin invite handled separately
- pm_update/pm_delete: use user_id check directly
- projects_select: use a subquery that won't recurse (direct table access with no RLS via security definer function)

## Approach
Use auth.uid() = user_id for the project_members SELECT policy to break the recursion.
For projects, use a security definer function to check membership without triggering RLS on project_members.
*/

-- Create a helper function that bypasses RLS to check membership
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.get_project_role(p_project_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM project_members
  WHERE project_id = p_project_id AND user_id = p_user_id
  LIMIT 1;
$$;

-- Fix project_members policies (remove self-reference)
DROP POLICY IF EXISTS "pm_select" ON project_members;
CREATE POLICY "pm_select" ON project_members FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "pm_insert" ON project_members;
CREATE POLICY "pm_insert" ON project_members FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    OR public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "pm_update" ON project_members;
CREATE POLICY "pm_update" ON project_members FOR UPDATE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  ) WITH CHECK (
    public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "pm_delete" ON project_members;
CREATE POLICY "pm_delete" ON project_members FOR DELETE
  TO authenticated USING (
    user_id = auth.uid()
    OR public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  );

-- Fix projects policies to use the helper function
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  TO authenticated USING (
    public.is_project_member(id, auth.uid()) OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  TO authenticated USING (
    public.get_project_role(id, auth.uid()) IN ('supervisor', 'admin')
  ) WITH CHECK (
    public.get_project_role(id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  TO authenticated USING (
    public.get_project_role(id, auth.uid()) = 'admin'
  );

-- Fix all other tables that reference project_members in their policies
-- Locations
DROP POLICY IF EXISTS "locations_select" ON locations;
CREATE POLICY "locations_select" ON locations FOR SELECT
  TO authenticated USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "locations_insert" ON locations;
CREATE POLICY "locations_insert" ON locations FOR INSERT
  TO authenticated WITH CHECK (
    public.get_project_role(project_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "locations_update" ON locations;
CREATE POLICY "locations_update" ON locations FOR UPDATE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  ) WITH CHECK (
    public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "locations_delete" ON locations;
CREATE POLICY "locations_delete" ON locations FOR DELETE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) = 'admin'
  );

-- Systems
DROP POLICY IF EXISTS "systems_select" ON systems;
CREATE POLICY "systems_select" ON systems FOR SELECT
  TO authenticated USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "systems_insert" ON systems;
CREATE POLICY "systems_insert" ON systems FOR INSERT
  TO authenticated WITH CHECK (
    public.get_project_role(project_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "systems_update" ON systems;
CREATE POLICY "systems_update" ON systems FOR UPDATE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  ) WITH CHECK (
    public.get_project_role(project_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "systems_delete" ON systems;
CREATE POLICY "systems_delete" ON systems FOR DELETE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) = 'admin'
  );

-- Assets
DROP POLICY IF EXISTS "assets_select" ON assets;
CREATE POLICY "assets_select" ON assets FOR SELECT
  TO authenticated USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "assets_insert" ON assets;
CREATE POLICY "assets_insert" ON assets FOR INSERT
  TO authenticated WITH CHECK (
    public.get_project_role(project_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "assets_update" ON assets;
CREATE POLICY "assets_update" ON assets FOR UPDATE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  ) WITH CHECK (
    public.get_project_role(project_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "assets_delete" ON assets;
CREATE POLICY "assets_delete" ON assets FOR DELETE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) = 'admin'
  );

-- Events (need to join through assets)
CREATE OR REPLACE FUNCTION public.get_asset_project_id(p_asset_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM assets WHERE id = p_asset_id;
$$;

DROP POLICY IF EXISTS "events_select" ON events;
CREATE POLICY "events_select" ON events FOR SELECT
  TO authenticated USING (
    public.is_project_member(public.get_asset_project_id(asset_id), auth.uid())
  );

DROP POLICY IF EXISTS "events_insert" ON events;
CREATE POLICY "events_insert" ON events FOR INSERT
  TO authenticated WITH CHECK (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "events_update" ON events;
CREATE POLICY "events_update" ON events FOR UPDATE
  TO authenticated USING (
    user_id = auth.uid() OR public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('supervisor', 'admin')
  ) WITH CHECK (
    user_id = auth.uid() OR public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "events_delete" ON events;
CREATE POLICY "events_delete" ON events FOR DELETE
  TO authenticated USING (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) = 'admin'
  );

-- Issues
DROP POLICY IF EXISTS "issues_select" ON issues;
CREATE POLICY "issues_select" ON issues FOR SELECT
  TO authenticated USING (
    public.is_project_member(public.get_asset_project_id(asset_id), auth.uid())
  );

DROP POLICY IF EXISTS "issues_insert" ON issues;
CREATE POLICY "issues_insert" ON issues FOR INSERT
  TO authenticated WITH CHECK (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "issues_update" ON issues;
CREATE POLICY "issues_update" ON issues FOR UPDATE
  TO authenticated USING (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  ) WITH CHECK (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "issues_delete" ON issues;
CREATE POLICY "issues_delete" ON issues FOR DELETE
  TO authenticated USING (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) = 'admin'
  );

-- Photos
DROP POLICY IF EXISTS "photos_select" ON photos;
CREATE POLICY "photos_select" ON photos FOR SELECT
  TO authenticated USING (
    public.is_project_member(public.get_asset_project_id(asset_id), auth.uid())
  );

DROP POLICY IF EXISTS "photos_insert" ON photos;
CREATE POLICY "photos_insert" ON photos FOR INSERT
  TO authenticated WITH CHECK (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

DROP POLICY IF EXISTS "photos_delete" ON photos;
CREATE POLICY "photos_delete" ON photos FOR DELETE
  TO authenticated USING (
    uploaded_by = auth.uid() OR public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) = 'admin'
  );

-- Status history
DROP POLICY IF EXISTS "status_history_select" ON status_history;
CREATE POLICY "status_history_select" ON status_history FOR SELECT
  TO authenticated USING (
    public.is_project_member(public.get_asset_project_id(asset_id), auth.uid())
  );

DROP POLICY IF EXISTS "status_history_insert" ON status_history;
CREATE POLICY "status_history_insert" ON status_history FOR INSERT
  TO authenticated WITH CHECK (
    public.get_project_role(public.get_asset_project_id(asset_id), auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );
