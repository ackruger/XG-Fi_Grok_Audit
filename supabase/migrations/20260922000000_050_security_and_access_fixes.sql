/*
# Security and access fixes

- Accept facility invitations transactionally for the signed-in invitee.
- Ensure facility members also have parent organization membership for org context/shared data.
- Make viewer access read-only on operational data.
- Allow supervisors to manage non-admin facility members/invitations; only admins can grant/manage admin.
- Restore facility-scoped storage policies for photos and asset documents.
*/

CREATE OR REPLACE FUNCTION can_write_facility(p_facility_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_facility_role(p_facility_id, p_user_id) IN ('contributor', 'reviewer', 'supervisor', 'admin');
$$;
REVOKE ALL ON FUNCTION can_write_facility(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_write_facility(uuid, uuid) TO authenticated;

-- Existing direct facility members need organization membership so the app can load
-- their organization context and shared asset types. This does not grant access to
-- other facilities because facility access remains separately enforced.
INSERT INTO organization_members (organization_id, user_id, role)
SELECT DISTINCT f.organization_id, fm.user_id, 'member'
FROM facility_members fm
JOIN facilities f ON f.id = fm.facility_id
ON CONFLICT (organization_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION accept_pending_facility_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(COALESCE(auth.jwt() ->> 'email', ''));
  v_inv record;
  v_count integer := 0;
  v_org_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_inv IN
    SELECT id, facility_id, role
    FROM facility_invitations
    WHERE lower(email) = v_email
      AND status = 'pending'
    FOR UPDATE
  LOOP
    SELECT organization_id INTO v_org_id
    FROM facilities
    WHERE id = v_inv.facility_id;

    IF v_org_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO facility_members (facility_id, user_id, role)
    VALUES (v_inv.facility_id, v_user_id, v_inv.role)
    ON CONFLICT (facility_id, user_id)
    DO UPDATE SET role = EXCLUDED.role;

    UPDATE facility_invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = v_inv.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION accept_pending_facility_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_pending_facility_invitations() TO authenticated;

-- Facility member management: admin can manage all. Supervisor can manage only non-admin rows.
DROP POLICY IF EXISTS "fac_members_insert" ON facility_members;
CREATE POLICY "fac_members_insert" ON facility_members FOR INSERT TO authenticated
WITH CHECK (
  get_facility_role(facility_id, auth.uid()) = 'admin'
  OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
);

DROP POLICY IF EXISTS "fac_members_update" ON facility_members;
CREATE POLICY "fac_members_update" ON facility_members FOR UPDATE TO authenticated
USING (
  get_facility_role(facility_id, auth.uid()) = 'admin'
  OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
)
WITH CHECK (
  get_facility_role(facility_id, auth.uid()) = 'admin'
  OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
);

DROP POLICY IF EXISTS "fac_members_delete" ON facility_members;
CREATE POLICY "fac_members_delete" ON facility_members FOR DELETE TO authenticated
USING (
  get_facility_role(facility_id, auth.uid()) = 'admin'
  OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
);

-- Invitation management follows the same rule and records the actual inviter.
DROP POLICY IF EXISTS "fac_inv_insert" ON facility_invitations;
CREATE POLICY "fac_inv_insert" ON facility_invitations FOR INSERT TO authenticated
WITH CHECK (
  invited_by = auth.uid()
  AND (
    get_facility_role(facility_id, auth.uid()) = 'admin'
    OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
  )
);

DROP POLICY IF EXISTS "fac_inv_update" ON facility_invitations;
CREATE POLICY "fac_inv_update" ON facility_invitations FOR UPDATE TO authenticated
USING (
  get_facility_role(facility_id, auth.uid()) = 'admin'
  OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
)
WITH CHECK (
  get_facility_role(facility_id, auth.uid()) = 'admin'
  OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
);

DROP POLICY IF EXISTS "fac_inv_delete" ON facility_invitations;
CREATE POLICY "fac_inv_delete" ON facility_invitations FOR DELETE TO authenticated
USING (
  get_facility_role(facility_id, auth.uid()) = 'admin'
  OR (get_facility_role(facility_id, auth.uid()) = 'supervisor' AND role <> 'admin')
);

-- Direct facility-scoped operational tables: viewers are read-only.
DROP POLICY IF EXISTS "fac_assets_insert" ON assets;
CREATE POLICY "fac_assets_insert" ON assets FOR INSERT TO authenticated
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_assets_update" ON assets;
CREATE POLICY "fac_assets_update" ON assets FOR UPDATE TO authenticated
USING (can_write_facility(facility_id, auth.uid()))
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_assets_delete" ON assets;
CREATE POLICY "fac_assets_delete" ON assets FOR DELETE TO authenticated
USING (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_locations_insert" ON locations;
CREATE POLICY "fac_locations_insert" ON locations FOR INSERT TO authenticated
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_locations_update" ON locations;
CREATE POLICY "fac_locations_update" ON locations FOR UPDATE TO authenticated
USING (can_write_facility(facility_id, auth.uid()))
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_locations_delete" ON locations;
CREATE POLICY "fac_locations_delete" ON locations FOR DELETE TO authenticated
USING (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_systems_insert" ON systems;
CREATE POLICY "fac_systems_insert" ON systems FOR INSERT TO authenticated
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_systems_update" ON systems;
CREATE POLICY "fac_systems_update" ON systems FOR UPDATE TO authenticated
USING (can_write_facility(facility_id, auth.uid()))
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_systems_delete" ON systems;
CREATE POLICY "fac_systems_delete" ON systems FOR DELETE TO authenticated
USING (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_tags_insert" ON tags;
CREATE POLICY "fac_tags_insert" ON tags FOR INSERT TO authenticated
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_tags_update" ON tags;
CREATE POLICY "fac_tags_update" ON tags FOR UPDATE TO authenticated
USING (can_write_facility(facility_id, auth.uid()))
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_tags_delete" ON tags;
CREATE POLICY "fac_tags_delete" ON tags FOR DELETE TO authenticated
USING (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_activity_insert" ON activity_posts;
CREATE POLICY "fac_activity_insert" ON activity_posts FOR INSERT TO authenticated
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_activity_update" ON activity_posts;
CREATE POLICY "fac_activity_update" ON activity_posts FOR UPDATE TO authenticated
USING (can_write_facility(facility_id, auth.uid()))
WITH CHECK (can_write_facility(facility_id, auth.uid()));
DROP POLICY IF EXISTS "fac_activity_delete" ON activity_posts;
CREATE POLICY "fac_activity_delete" ON activity_posts FOR DELETE TO authenticated
USING (can_write_facility(facility_id, auth.uid()) AND (user_id = auth.uid() OR get_facility_role(facility_id, auth.uid()) IN ('supervisor','admin')));

-- Asset-child operational tables: viewer remains read-only.
DROP POLICY IF EXISTS "fac_events_insert" ON events;
CREATE POLICY "fac_events_insert" ON events FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_events_update" ON events;
CREATE POLICY "fac_events_update" ON events FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_events_delete" ON events;
CREATE POLICY "fac_events_delete" ON events FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_issues_insert" ON issues;
CREATE POLICY "fac_issues_insert" ON issues FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_issues_update" ON issues;
CREATE POLICY "fac_issues_update" ON issues FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_issues_delete" ON issues;
CREATE POLICY "fac_issues_delete" ON issues FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_photos_insert" ON photos;
CREATE POLICY "fac_photos_insert" ON photos FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_photos_update" ON photos;
CREATE POLICY "fac_photos_update" ON photos FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_photos_delete" ON photos;
CREATE POLICY "fac_photos_delete" ON photos FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_notes_insert" ON asset_notes;
CREATE POLICY "fac_notes_insert" ON asset_notes FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_notes_update" ON asset_notes;
CREATE POLICY "fac_notes_update" ON asset_notes FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_notes_delete" ON asset_notes;
CREATE POLICY "fac_notes_delete" ON asset_notes FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_asset_tags_insert" ON asset_tags;
CREATE POLICY "fac_asset_tags_insert" ON asset_tags FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_asset_tags_update" ON asset_tags;
CREATE POLICY "fac_asset_tags_update" ON asset_tags FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_asset_tags_delete" ON asset_tags;
CREATE POLICY "fac_asset_tags_delete" ON asset_tags FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_status_history_insert" ON status_history;
CREATE POLICY "fac_status_history_insert" ON status_history FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_status_history_update" ON status_history;
CREATE POLICY "fac_status_history_update" ON status_history FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_status_history_delete" ON status_history;
CREATE POLICY "fac_status_history_delete" ON status_history FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_profiles_insert" ON asset_design_profiles;
CREATE POLICY "fac_profiles_insert" ON asset_design_profiles FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_profiles_update" ON asset_design_profiles;
CREATE POLICY "fac_profiles_update" ON asset_design_profiles FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_profiles_delete" ON asset_design_profiles;
CREATE POLICY "fac_profiles_delete" ON asset_design_profiles FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_attr_values_insert" ON asset_attribute_values;
CREATE POLICY "fac_attr_values_insert" ON asset_attribute_values FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_attr_values_update" ON asset_attribute_values;
CREATE POLICY "fac_attr_values_update" ON asset_attribute_values FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_attr_values_delete" ON asset_attribute_values;
CREATE POLICY "fac_attr_values_delete" ON asset_attribute_values FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_rel_insert" ON asset_relationships;
CREATE POLICY "fac_rel_insert" ON asset_relationships FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(source_asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_rel_update" ON asset_relationships;
CREATE POLICY "fac_rel_update" ON asset_relationships FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(source_asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(source_asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_rel_delete" ON asset_relationships;
CREATE POLICY "fac_rel_delete" ON asset_relationships FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(source_asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_service_parts_insert" ON asset_service_parts;
CREATE POLICY "fac_service_parts_insert" ON asset_service_parts FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_service_parts_update" ON asset_service_parts;
CREATE POLICY "fac_service_parts_update" ON asset_service_parts FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_service_parts_delete" ON asset_service_parts;
CREATE POLICY "fac_service_parts_delete" ON asset_service_parts FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_docs_insert" ON asset_documents;
CREATE POLICY "fac_docs_insert" ON asset_documents FOR INSERT TO authenticated WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_docs_update" ON asset_documents;
CREATE POLICY "fac_docs_update" ON asset_documents FOR UPDATE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid())) WITH CHECK (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));
DROP POLICY IF EXISTS "fac_docs_delete" ON asset_documents;
CREATE POLICY "fac_docs_delete" ON asset_documents FOR DELETE TO authenticated USING (can_write_facility(get_asset_facility_id(asset_id), auth.uid()));

-- Comments are scoped through their parent event/case and are writable only by non-viewers.
DROP POLICY IF EXISTS "fac_comments_insert" ON comments;
CREATE POLICY "fac_comments_insert" ON comments FOR INSERT TO authenticated
WITH CHECK (
  (event_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM events WHERE id = comments.event_id)), auth.uid()))
  OR (issue_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM issues WHERE id = comments.issue_id)), auth.uid()))
);
DROP POLICY IF EXISTS "fac_comments_update" ON comments;
CREATE POLICY "fac_comments_update" ON comments FOR UPDATE TO authenticated
USING (
  user_id = auth.uid() AND (
    (event_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM events WHERE id = comments.event_id)), auth.uid()))
    OR (issue_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM issues WHERE id = comments.issue_id)), auth.uid()))
  )
)
WITH CHECK (
  user_id = auth.uid() AND (
    (event_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM events WHERE id = comments.event_id)), auth.uid()))
    OR (issue_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM issues WHERE id = comments.issue_id)), auth.uid()))
  )
);
DROP POLICY IF EXISTS "fac_comments_delete" ON comments;
CREATE POLICY "fac_comments_delete" ON comments FOR DELETE TO authenticated
USING (
  user_id = auth.uid() AND (
    (event_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM events WHERE id = comments.event_id)), auth.uid()))
    OR (issue_id IS NOT NULL AND can_write_facility(get_asset_facility_id((SELECT asset_id FROM issues WHERE id = comments.issue_id)), auth.uid()))
  )
);

-- Storage: remove broad legacy photo policies and scope writes to facility roles.
DROP POLICY IF EXISTS "Authenticated users can read photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update photos" ON storage.objects;

CREATE POLICY "Facility members can read photos" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM facilities f
    WHERE f.id::text = (storage.foldername(name))[1]
      AND is_facility_member(f.id, auth.uid())
  )
);
CREATE POLICY "Facility writers can upload photos" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM facilities f
    WHERE f.id::text = (storage.foldername(name))[1]
      AND can_write_facility(f.id, auth.uid())
  )
);
CREATE POLICY "Facility writers can update photos" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'photos'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND can_write_facility(f.id, auth.uid()))
)
WITH CHECK (
  bucket_id = 'photos'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND can_write_facility(f.id, auth.uid()))
);
CREATE POLICY "Facility writers can delete photos" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'photos'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND can_write_facility(f.id, auth.uid()))
);

-- Asset document storage policies were dropped during project->facility migration; restore them.
DROP POLICY IF EXISTS "asset_docs_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "asset_docs_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "asset_docs_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "asset_docs_storage_delete" ON storage.objects;
CREATE POLICY "asset_docs_storage_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'asset-documents'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND is_facility_member(f.id, auth.uid()))
);
CREATE POLICY "asset_docs_storage_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'asset-documents'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND can_write_facility(f.id, auth.uid()))
);
CREATE POLICY "asset_docs_storage_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'asset-documents'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND can_write_facility(f.id, auth.uid()))
)
WITH CHECK (
  bucket_id = 'asset-documents'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND can_write_facility(f.id, auth.uid()))
);
CREATE POLICY "asset_docs_storage_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'asset-documents'
  AND EXISTS (SELECT 1 FROM facilities f WHERE f.id::text = (storage.foldername(name))[1] AND can_write_facility(f.id, auth.uid()))
);
