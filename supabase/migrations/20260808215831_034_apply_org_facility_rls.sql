/*
# Apply RLS Policies for Organization/Facility Tables

1. organizations
   - SELECT: org members can read their orgs
   - INSERT: any authenticated user can create an org
   - UPDATE: org admins only
   - DELETE: org admins only

2. organization_members
   - SELECT: org members can see fellow members
   - INSERT: org admins can add members
   - UPDATE: org admins can change roles
   - DELETE: org admins can remove members

3. facilities
   - SELECT: facility members OR org admins can see facilities
   - INSERT: org admins or managers can create facilities
   - UPDATE: facility admins or org admins can edit
   - DELETE: org admins only

4. facility_members
   - SELECT: facility members or org admins
   - INSERT: facility admins or org admins
   - UPDATE: facility admins or org admins
   - DELETE: facility admins or org admins

5. facility_invitations
   - SELECT: facility admin/supervisor can see all; invitee can see their own
   - INSERT: facility admin/supervisor
   - UPDATE: facility admin/supervisor
   - DELETE: facility admin/supervisor

6. Notes
   - Org admin has implicit admin over all org facilities (encoded in helper functions).
   - Creating an org does NOT auto-add the creator as admin — use bootstrap_org_admin.
*/

-- ===== ORGANIZATIONS =====
DROP POLICY IF EXISTS "org_select" ON organizations;
CREATE POLICY "org_select" ON organizations FOR SELECT TO authenticated
  USING (is_org_member(id, auth.uid()));

DROP POLICY IF EXISTS "org_insert" ON organizations;
CREATE POLICY "org_insert" ON organizations FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "org_update" ON organizations;
CREATE POLICY "org_update" ON organizations FOR UPDATE TO authenticated
  USING (get_org_role(id, auth.uid()) = 'admin')
  WITH CHECK (get_org_role(id, auth.uid()) = 'admin');

DROP POLICY IF EXISTS "org_delete" ON organizations;
CREATE POLICY "org_delete" ON organizations FOR DELETE TO authenticated
  USING (get_org_role(id, auth.uid()) = 'admin');

-- ===== ORGANIZATION MEMBERS =====
DROP POLICY IF EXISTS "org_members_select" ON organization_members;
CREATE POLICY "org_members_select" ON organization_members FOR SELECT TO authenticated
  USING (is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "org_members_insert" ON organization_members;
CREATE POLICY "org_members_insert" ON organization_members FOR INSERT TO authenticated
  WITH CHECK (get_org_role(organization_id, auth.uid()) = 'admin');

DROP POLICY IF EXISTS "org_members_update" ON organization_members;
CREATE POLICY "org_members_update" ON organization_members FOR UPDATE TO authenticated
  USING (get_org_role(organization_id, auth.uid()) = 'admin')
  WITH CHECK (get_org_role(organization_id, auth.uid()) = 'admin');

DROP POLICY IF EXISTS "org_members_delete" ON organization_members;
CREATE POLICY "org_members_delete" ON organization_members FOR DELETE TO authenticated
  USING (get_org_role(organization_id, auth.uid()) = 'admin');

-- ===== FACILITIES =====
DROP POLICY IF EXISTS "facility_select" ON facilities;
CREATE POLICY "facility_select" ON facilities FOR SELECT TO authenticated
  USING (is_facility_member(id, auth.uid()));

DROP POLICY IF EXISTS "facility_insert" ON facilities;
CREATE POLICY "facility_insert" ON facilities FOR INSERT TO authenticated
  WITH CHECK (get_org_role(organization_id, auth.uid()) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "facility_update" ON facilities;
CREATE POLICY "facility_update" ON facilities FOR UPDATE TO authenticated
  USING (
    get_facility_role(id, auth.uid()) = 'admin'
    OR get_org_role(organization_id, auth.uid()) = 'admin'
  )
  WITH CHECK (
    get_facility_role(id, auth.uid()) = 'admin'
    OR get_org_role(organization_id, auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "facility_delete" ON facilities;
CREATE POLICY "facility_delete" ON facilities FOR DELETE TO authenticated
  USING (get_org_role(organization_id, auth.uid()) = 'admin');

-- ===== FACILITY MEMBERS =====
DROP POLICY IF EXISTS "fac_members_select" ON facility_members;
CREATE POLICY "fac_members_select" ON facility_members FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_members_insert" ON facility_members;
CREATE POLICY "fac_members_insert" ON facility_members FOR INSERT TO authenticated
  WITH CHECK (
    get_facility_role(facility_id, auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "fac_members_update" ON facility_members;
CREATE POLICY "fac_members_update" ON facility_members FOR UPDATE TO authenticated
  USING (get_facility_role(facility_id, auth.uid()) = 'admin')
  WITH CHECK (get_facility_role(facility_id, auth.uid()) = 'admin');

DROP POLICY IF EXISTS "fac_members_delete" ON facility_members;
CREATE POLICY "fac_members_delete" ON facility_members FOR DELETE TO authenticated
  USING (get_facility_role(facility_id, auth.uid()) = 'admin');

-- ===== FACILITY INVITATIONS =====
DROP POLICY IF EXISTS "fac_inv_select" ON facility_invitations;
CREATE POLICY "fac_inv_select" ON facility_invitations FOR SELECT TO authenticated
  USING (
    get_facility_role(facility_id, auth.uid()) IN ('admin', 'supervisor')
    OR lower(email) = lower(auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS "fac_inv_insert" ON facility_invitations;
CREATE POLICY "fac_inv_insert" ON facility_invitations FOR INSERT TO authenticated
  WITH CHECK (get_facility_role(facility_id, auth.uid()) IN ('admin', 'supervisor'));

DROP POLICY IF EXISTS "fac_inv_update" ON facility_invitations;
CREATE POLICY "fac_inv_update" ON facility_invitations FOR UPDATE TO authenticated
  USING (get_facility_role(facility_id, auth.uid()) IN ('admin', 'supervisor'))
  WITH CHECK (get_facility_role(facility_id, auth.uid()) IN ('admin', 'supervisor'));

DROP POLICY IF EXISTS "fac_inv_delete" ON facility_invitations;
CREATE POLICY "fac_inv_delete" ON facility_invitations FOR DELETE TO authenticated
  USING (get_facility_role(facility_id, auth.uid()) IN ('admin', 'supervisor'));
