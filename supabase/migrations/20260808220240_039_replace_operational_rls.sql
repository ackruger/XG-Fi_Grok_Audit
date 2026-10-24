/*
# Replace All Operational RLS Policies with Facility/Organization-Based Policies

All old project-based policies were dropped in migration 037.
This migration creates the complete replacement set.

Security model:
- Direct facility_id tables: access via is_facility_member(facility_id, auth.uid())
- Asset child tables: access via is_facility_member(get_asset_facility_id(asset_id), auth.uid())
- Asset types: access via is_org_member(organization_id, auth.uid())
- Attribute definitions: access via org membership through asset_types join
- Import records: access via batch → facility membership
- Write roles use get_facility_role / get_org_role for role checks

Org admin = implicit facility admin (encoded in helper functions).
*/

-- ===== ASSETS =====
DROP POLICY IF EXISTS "fac_assets_select" ON assets;
CREATE POLICY "fac_assets_select" ON assets FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_assets_insert" ON assets;
CREATE POLICY "fac_assets_insert" ON assets FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_assets_update" ON assets;
CREATE POLICY "fac_assets_update" ON assets FOR UPDATE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()))
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_assets_delete" ON assets;
CREATE POLICY "fac_assets_delete" ON assets FOR DELETE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

-- ===== LOCATIONS =====
DROP POLICY IF EXISTS "fac_locations_select" ON locations;
CREATE POLICY "fac_locations_select" ON locations FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_locations_insert" ON locations;
CREATE POLICY "fac_locations_insert" ON locations FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_locations_update" ON locations;
CREATE POLICY "fac_locations_update" ON locations FOR UPDATE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()))
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_locations_delete" ON locations;
CREATE POLICY "fac_locations_delete" ON locations FOR DELETE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

-- ===== SYSTEMS =====
DROP POLICY IF EXISTS "fac_systems_select" ON systems;
CREATE POLICY "fac_systems_select" ON systems FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_systems_insert" ON systems;
CREATE POLICY "fac_systems_insert" ON systems FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_systems_update" ON systems;
CREATE POLICY "fac_systems_update" ON systems FOR UPDATE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()))
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_systems_delete" ON systems;
CREATE POLICY "fac_systems_delete" ON systems FOR DELETE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

-- ===== TAGS =====
DROP POLICY IF EXISTS "fac_tags_select" ON tags;
CREATE POLICY "fac_tags_select" ON tags FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_tags_insert" ON tags;
CREATE POLICY "fac_tags_insert" ON tags FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_tags_update" ON tags;
CREATE POLICY "fac_tags_update" ON tags FOR UPDATE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()))
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_tags_delete" ON tags;
CREATE POLICY "fac_tags_delete" ON tags FOR DELETE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

-- ===== ACTIVITY POSTS =====
DROP POLICY IF EXISTS "fac_activity_select" ON activity_posts;
CREATE POLICY "fac_activity_select" ON activity_posts FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_activity_insert" ON activity_posts;
CREATE POLICY "fac_activity_insert" ON activity_posts FOR INSERT TO authenticated
  WITH CHECK (
    is_facility_member(facility_id, auth.uid())
    AND get_facility_role(facility_id, auth.uid()) IN ('contributor','reviewer','supervisor','admin')
  );

DROP POLICY IF EXISTS "fac_activity_update" ON activity_posts;
CREATE POLICY "fac_activity_update" ON activity_posts FOR UPDATE TO authenticated
  USING (is_facility_member(facility_id, auth.uid()))
  WITH CHECK (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_activity_delete" ON activity_posts;
CREATE POLICY "fac_activity_delete" ON activity_posts FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR get_facility_role(facility_id, auth.uid()) = 'admin'
  );

-- ===== ASSET TYPES (org-level) =====
DROP POLICY IF EXISTS "org_asset_types_select" ON asset_types;
CREATE POLICY "org_asset_types_select" ON asset_types FOR SELECT TO authenticated
  USING (is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "org_asset_types_insert" ON asset_types;
CREATE POLICY "org_asset_types_insert" ON asset_types FOR INSERT TO authenticated
  WITH CHECK (get_org_role(organization_id, auth.uid()) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "org_asset_types_update" ON asset_types;
CREATE POLICY "org_asset_types_update" ON asset_types FOR UPDATE TO authenticated
  USING (get_org_role(organization_id, auth.uid()) IN ('admin', 'manager'))
  WITH CHECK (get_org_role(organization_id, auth.uid()) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "org_asset_types_delete" ON asset_types;
CREATE POLICY "org_asset_types_delete" ON asset_types FOR DELETE TO authenticated
  USING (get_org_role(organization_id, auth.uid()) = 'admin');

-- ===== ASSET ATTRIBUTE DEFINITIONS (via asset_types → org) =====
DROP POLICY IF EXISTS "org_attr_defs_select" ON asset_attribute_definitions;
CREATE POLICY "org_attr_defs_select" ON asset_attribute_definitions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_types at
    WHERE at.id = asset_attribute_definitions.asset_type_id
      AND is_org_member(at.organization_id, auth.uid())
  ));

DROP POLICY IF EXISTS "org_attr_defs_insert" ON asset_attribute_definitions;
CREATE POLICY "org_attr_defs_insert" ON asset_attribute_definitions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_types at
    WHERE at.id = asset_attribute_definitions.asset_type_id
      AND get_org_role(at.organization_id, auth.uid()) IN ('admin', 'manager')
  ));

DROP POLICY IF EXISTS "org_attr_defs_update" ON asset_attribute_definitions;
CREATE POLICY "org_attr_defs_update" ON asset_attribute_definitions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_types at
    WHERE at.id = asset_attribute_definitions.asset_type_id
      AND get_org_role(at.organization_id, auth.uid()) IN ('admin', 'manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_types at
    WHERE at.id = asset_attribute_definitions.asset_type_id
      AND get_org_role(at.organization_id, auth.uid()) IN ('admin', 'manager')
  ));

DROP POLICY IF EXISTS "org_attr_defs_delete" ON asset_attribute_definitions;
CREATE POLICY "org_attr_defs_delete" ON asset_attribute_definitions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_types at
    WHERE at.id = asset_attribute_definitions.asset_type_id
      AND get_org_role(at.organization_id, auth.uid()) = 'admin'
  ));

-- ===== CHILD TABLES (scoped through asset → facility) =====

-- Events
DROP POLICY IF EXISTS "fac_events_select" ON events;
CREATE POLICY "fac_events_select" ON events FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_events_insert" ON events;
CREATE POLICY "fac_events_insert" ON events FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_events_update" ON events;
CREATE POLICY "fac_events_update" ON events FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_events_delete" ON events;
CREATE POLICY "fac_events_delete" ON events FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Issues
DROP POLICY IF EXISTS "fac_issues_select" ON issues;
CREATE POLICY "fac_issues_select" ON issues FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_issues_insert" ON issues;
CREATE POLICY "fac_issues_insert" ON issues FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_issues_update" ON issues;
CREATE POLICY "fac_issues_update" ON issues FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_issues_delete" ON issues;
CREATE POLICY "fac_issues_delete" ON issues FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Photos
DROP POLICY IF EXISTS "fac_photos_select" ON photos;
CREATE POLICY "fac_photos_select" ON photos FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_photos_insert" ON photos;
CREATE POLICY "fac_photos_insert" ON photos FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_photos_update" ON photos;
CREATE POLICY "fac_photos_update" ON photos FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_photos_delete" ON photos;
CREATE POLICY "fac_photos_delete" ON photos FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Asset Notes
DROP POLICY IF EXISTS "fac_notes_select" ON asset_notes;
CREATE POLICY "fac_notes_select" ON asset_notes FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_notes_insert" ON asset_notes;
CREATE POLICY "fac_notes_insert" ON asset_notes FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_notes_update" ON asset_notes;
CREATE POLICY "fac_notes_update" ON asset_notes FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_notes_delete" ON asset_notes;
CREATE POLICY "fac_notes_delete" ON asset_notes FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Asset Tags
DROP POLICY IF EXISTS "fac_asset_tags_select" ON asset_tags;
CREATE POLICY "fac_asset_tags_select" ON asset_tags FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_asset_tags_insert" ON asset_tags;
CREATE POLICY "fac_asset_tags_insert" ON asset_tags FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_asset_tags_update" ON asset_tags;
CREATE POLICY "fac_asset_tags_update" ON asset_tags FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_asset_tags_delete" ON asset_tags;
CREATE POLICY "fac_asset_tags_delete" ON asset_tags FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Status History
DROP POLICY IF EXISTS "fac_status_history_select" ON status_history;
CREATE POLICY "fac_status_history_select" ON status_history FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_status_history_insert" ON status_history;
CREATE POLICY "fac_status_history_insert" ON status_history FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_status_history_update" ON status_history;
CREATE POLICY "fac_status_history_update" ON status_history FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_status_history_delete" ON status_history;
CREATE POLICY "fac_status_history_delete" ON status_history FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Comments (scoped via event → asset or issue → asset)
DROP POLICY IF EXISTS "fac_comments_select" ON comments;
CREATE POLICY "fac_comments_select" ON comments FOR SELECT TO authenticated
  USING (
    (event_id IS NOT NULL AND is_facility_member(get_asset_facility_id((SELECT asset_id FROM events WHERE id = comments.event_id)), auth.uid()))
    OR (issue_id IS NOT NULL AND is_facility_member(get_asset_facility_id((SELECT asset_id FROM issues WHERE id = comments.issue_id)), auth.uid()))
  );

DROP POLICY IF EXISTS "fac_comments_insert" ON comments;
CREATE POLICY "fac_comments_insert" ON comments FOR INSERT TO authenticated
  WITH CHECK (
    (event_id IS NOT NULL AND is_facility_member(get_asset_facility_id((SELECT asset_id FROM events WHERE id = comments.event_id)), auth.uid()))
    OR (issue_id IS NOT NULL AND is_facility_member(get_asset_facility_id((SELECT asset_id FROM issues WHERE id = comments.issue_id)), auth.uid()))
  );

DROP POLICY IF EXISTS "fac_comments_update" ON comments;
CREATE POLICY "fac_comments_update" ON comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "fac_comments_delete" ON comments;
CREATE POLICY "fac_comments_delete" ON comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Design Profiles
DROP POLICY IF EXISTS "fac_profiles_select" ON asset_design_profiles;
CREATE POLICY "fac_profiles_select" ON asset_design_profiles FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_profiles_insert" ON asset_design_profiles;
CREATE POLICY "fac_profiles_insert" ON asset_design_profiles FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_profiles_update" ON asset_design_profiles;
CREATE POLICY "fac_profiles_update" ON asset_design_profiles FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_profiles_delete" ON asset_design_profiles;
CREATE POLICY "fac_profiles_delete" ON asset_design_profiles FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Attribute Values
DROP POLICY IF EXISTS "fac_attr_values_select" ON asset_attribute_values;
CREATE POLICY "fac_attr_values_select" ON asset_attribute_values FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_attr_values_insert" ON asset_attribute_values;
CREATE POLICY "fac_attr_values_insert" ON asset_attribute_values FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_attr_values_update" ON asset_attribute_values;
CREATE POLICY "fac_attr_values_update" ON asset_attribute_values FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_attr_values_delete" ON asset_attribute_values;
CREATE POLICY "fac_attr_values_delete" ON asset_attribute_values FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Relationships
DROP POLICY IF EXISTS "fac_rel_select" ON asset_relationships;
CREATE POLICY "fac_rel_select" ON asset_relationships FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(source_asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_rel_insert" ON asset_relationships;
CREATE POLICY "fac_rel_insert" ON asset_relationships FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(source_asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_rel_update" ON asset_relationships;
CREATE POLICY "fac_rel_update" ON asset_relationships FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(source_asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(source_asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_rel_delete" ON asset_relationships;
CREATE POLICY "fac_rel_delete" ON asset_relationships FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(source_asset_id), auth.uid()));

-- Service Parts
DROP POLICY IF EXISTS "fac_service_parts_select" ON asset_service_parts;
CREATE POLICY "fac_service_parts_select" ON asset_service_parts FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_service_parts_insert" ON asset_service_parts;
CREATE POLICY "fac_service_parts_insert" ON asset_service_parts FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_service_parts_update" ON asset_service_parts;
CREATE POLICY "fac_service_parts_update" ON asset_service_parts FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_service_parts_delete" ON asset_service_parts;
CREATE POLICY "fac_service_parts_delete" ON asset_service_parts FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- Documents
DROP POLICY IF EXISTS "fac_docs_select" ON asset_documents;
CREATE POLICY "fac_docs_select" ON asset_documents FOR SELECT TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_docs_insert" ON asset_documents;
CREATE POLICY "fac_docs_insert" ON asset_documents FOR INSERT TO authenticated
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_docs_update" ON asset_documents;
CREATE POLICY "fac_docs_update" ON asset_documents FOR UPDATE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()))
  WITH CHECK (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

DROP POLICY IF EXISTS "fac_docs_delete" ON asset_documents;
CREATE POLICY "fac_docs_delete" ON asset_documents FOR DELETE TO authenticated
  USING (is_facility_member(get_asset_facility_id(asset_id), auth.uid()));

-- ===== IMPORT BATCHES =====
DROP POLICY IF EXISTS "fac_import_batches_select" ON asset_import_batches;
CREATE POLICY "fac_import_batches_select" ON asset_import_batches FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_import_batches_insert" ON asset_import_batches;
CREATE POLICY "fac_import_batches_insert" ON asset_import_batches FOR INSERT TO authenticated
  WITH CHECK (
    is_facility_member(facility_id, auth.uid())
    AND get_facility_role(facility_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "fac_import_batches_update" ON asset_import_batches;
CREATE POLICY "fac_import_batches_update" ON asset_import_batches FOR UPDATE TO authenticated
  USING (
    is_facility_member(facility_id, auth.uid())
    AND get_facility_role(facility_id, auth.uid()) IN ('supervisor', 'admin')
  )
  WITH CHECK (
    is_facility_member(facility_id, auth.uid())
    AND get_facility_role(facility_id, auth.uid()) IN ('supervisor', 'admin')
  );

DROP POLICY IF EXISTS "fac_import_batches_delete" ON asset_import_batches;
CREATE POLICY "fac_import_batches_delete" ON asset_import_batches FOR DELETE TO authenticated
  USING (get_facility_role(facility_id, auth.uid()) = 'admin');

-- ===== IMPORT RECORDS (via batch → facility) =====
DROP POLICY IF EXISTS "fac_import_records_select" ON asset_import_records;
CREATE POLICY "fac_import_records_select" ON asset_import_records FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_import_batches b
    WHERE b.id = asset_import_records.batch_id
      AND is_facility_member(b.facility_id, auth.uid())
  ));

DROP POLICY IF EXISTS "fac_import_records_insert" ON asset_import_records;
CREATE POLICY "fac_import_records_insert" ON asset_import_records FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_import_batches b
    WHERE b.id = asset_import_records.batch_id
      AND get_facility_role(b.facility_id, auth.uid()) IN ('supervisor', 'admin')
  ));

DROP POLICY IF EXISTS "fac_import_records_update" ON asset_import_records;
CREATE POLICY "fac_import_records_update" ON asset_import_records FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_import_batches b
    WHERE b.id = asset_import_records.batch_id
      AND get_facility_role(b.facility_id, auth.uid()) IN ('supervisor', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_import_batches b
    WHERE b.id = asset_import_records.batch_id
      AND get_facility_role(b.facility_id, auth.uid()) IN ('supervisor', 'admin')
  ));

DROP POLICY IF EXISTS "fac_import_records_delete" ON asset_import_records;
CREATE POLICY "fac_import_records_delete" ON asset_import_records FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_import_batches b
    WHERE b.id = asset_import_records.batch_id
      AND get_facility_role(b.facility_id, auth.uid()) = 'admin'
  ));
