/*
# Convert Operational Tables from project_id to facility_id

1. Tables Modified
   - assets, locations, systems, tags, activity_posts, asset_import_batches:
     DROP project_id, ADD facility_id

2. Approach
   - Drop ALL project-based RLS policies across ALL tables first
   - Drop old project-based triggers
   - Drop project_id columns from direct tables
   - Add facility_id columns
   - New policies created in migration 039

3. Notes
   - All operational tables are empty
   - Profiles, trades, auth.users untouched
*/

-- ========== DROP ALL PROJECT-BASED RLS POLICIES ==========

-- Direct project_id tables
DROP POLICY IF EXISTS "assets_select" ON assets;
DROP POLICY IF EXISTS "assets_insert" ON assets;
DROP POLICY IF EXISTS "assets_update" ON assets;
DROP POLICY IF EXISTS "assets_delete" ON assets;

DROP POLICY IF EXISTS "locations_select" ON locations;
DROP POLICY IF EXISTS "locations_insert" ON locations;
DROP POLICY IF EXISTS "locations_update" ON locations;
DROP POLICY IF EXISTS "locations_delete" ON locations;

DROP POLICY IF EXISTS "systems_select" ON systems;
DROP POLICY IF EXISTS "systems_insert" ON systems;
DROP POLICY IF EXISTS "systems_update" ON systems;
DROP POLICY IF EXISTS "systems_delete" ON systems;

DROP POLICY IF EXISTS "tags_select" ON tags;
DROP POLICY IF EXISTS "tags_insert" ON tags;
DROP POLICY IF EXISTS "tags_update" ON tags;
DROP POLICY IF EXISTS "tags_delete" ON tags;

DROP POLICY IF EXISTS "activity_posts_select" ON activity_posts;
DROP POLICY IF EXISTS "activity_posts_insert" ON activity_posts;
DROP POLICY IF EXISTS "activity_posts_update" ON activity_posts;
DROP POLICY IF EXISTS "activity_posts_delete" ON activity_posts;

DROP POLICY IF EXISTS "select_import_batches" ON asset_import_batches;
DROP POLICY IF EXISTS "insert_import_batches" ON asset_import_batches;
DROP POLICY IF EXISTS "update_import_batches" ON asset_import_batches;
DROP POLICY IF EXISTS "delete_import_batches" ON asset_import_batches;

DROP POLICY IF EXISTS "select_import_records" ON asset_import_records;
DROP POLICY IF EXISTS "insert_import_records" ON asset_import_records;
DROP POLICY IF EXISTS "update_import_records" ON asset_import_records;
DROP POLICY IF EXISTS "delete_import_records" ON asset_import_records;

-- Child tables (policies reference assets.project_id via joins/functions)
DROP POLICY IF EXISTS "events_select" ON events;
DROP POLICY IF EXISTS "events_insert" ON events;
DROP POLICY IF EXISTS "events_update" ON events;
DROP POLICY IF EXISTS "events_delete" ON events;

DROP POLICY IF EXISTS "issues_select" ON issues;
DROP POLICY IF EXISTS "issues_insert" ON issues;
DROP POLICY IF EXISTS "issues_update" ON issues;
DROP POLICY IF EXISTS "issues_delete" ON issues;

DROP POLICY IF EXISTS "photos_select" ON photos;
DROP POLICY IF EXISTS "photos_insert" ON photos;
DROP POLICY IF EXISTS "photos_update" ON photos;
DROP POLICY IF EXISTS "photos_delete" ON photos;

DROP POLICY IF EXISTS "asset_notes_select" ON asset_notes;
DROP POLICY IF EXISTS "asset_notes_insert" ON asset_notes;
DROP POLICY IF EXISTS "asset_notes_delete" ON asset_notes;

DROP POLICY IF EXISTS "asset_tags_select" ON asset_tags;
DROP POLICY IF EXISTS "asset_tags_insert" ON asset_tags;
DROP POLICY IF EXISTS "asset_tags_update" ON asset_tags;
DROP POLICY IF EXISTS "asset_tags_delete" ON asset_tags;

DROP POLICY IF EXISTS "status_history_select" ON status_history;
DROP POLICY IF EXISTS "status_history_insert" ON status_history;
DROP POLICY IF EXISTS "status_history_update" ON status_history;
DROP POLICY IF EXISTS "status_history_delete" ON status_history;

DROP POLICY IF EXISTS "comments_select" ON comments;
DROP POLICY IF EXISTS "comments_insert" ON comments;
DROP POLICY IF EXISTS "comments_update" ON comments;
DROP POLICY IF EXISTS "comments_delete" ON comments;

DROP POLICY IF EXISTS "design_profiles_select" ON asset_design_profiles;
DROP POLICY IF EXISTS "design_profiles_insert" ON asset_design_profiles;
DROP POLICY IF EXISTS "design_profiles_update" ON asset_design_profiles;
DROP POLICY IF EXISTS "design_profiles_delete" ON asset_design_profiles;

DROP POLICY IF EXISTS "attr_values_select" ON asset_attribute_values;
DROP POLICY IF EXISTS "attr_values_insert" ON asset_attribute_values;
DROP POLICY IF EXISTS "attr_values_update" ON asset_attribute_values;
DROP POLICY IF EXISTS "attr_values_delete" ON asset_attribute_values;

DROP POLICY IF EXISTS "rel_select" ON asset_relationships;
DROP POLICY IF EXISTS "rel_insert" ON asset_relationships;
DROP POLICY IF EXISTS "rel_update" ON asset_relationships;
DROP POLICY IF EXISTS "rel_delete" ON asset_relationships;

DROP POLICY IF EXISTS "service_parts_select" ON asset_service_parts;
DROP POLICY IF EXISTS "service_parts_insert" ON asset_service_parts;
DROP POLICY IF EXISTS "service_parts_update" ON asset_service_parts;
DROP POLICY IF EXISTS "service_parts_delete" ON asset_service_parts;

DROP POLICY IF EXISTS "asset_docs_select" ON asset_documents;
DROP POLICY IF EXISTS "asset_docs_insert" ON asset_documents;
DROP POLICY IF EXISTS "asset_docs_update" ON asset_documents;
DROP POLICY IF EXISTS "asset_docs_delete" ON asset_documents;

-- Storage policies that reference project_id
DROP POLICY IF EXISTS "asset_docs_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "asset_docs_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "asset_docs_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "asset_docs_storage_delete" ON storage.objects;

-- ========== DROP OLD TRIGGERS ==========
DROP TRIGGER IF EXISTS enforce_same_project_relationship ON asset_relationships;
DROP FUNCTION IF EXISTS check_relationship_same_project();

DROP TRIGGER IF EXISTS trg_asset_system_project_check ON assets;
DROP FUNCTION IF EXISTS check_asset_system_project_match();

-- ========== DROP OLD UNIQUE CONSTRAINTS ==========
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_project_id_name_key') THEN
    ALTER TABLE tags DROP CONSTRAINT tags_project_id_name_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_import_batches_project_id_source_fingerprint_key') THEN
    ALTER TABLE asset_import_batches DROP CONSTRAINT asset_import_batches_project_id_source_fingerprint_key;
  END IF;
END $$;

-- ========== DROP project_id COLUMNS ==========
ALTER TABLE assets DROP COLUMN IF EXISTS project_id;
ALTER TABLE locations DROP COLUMN IF EXISTS project_id;
ALTER TABLE systems DROP COLUMN IF EXISTS project_id;
ALTER TABLE tags DROP COLUMN IF EXISTS project_id;
ALTER TABLE activity_posts DROP COLUMN IF EXISTS project_id;
ALTER TABLE asset_import_batches DROP COLUMN IF EXISTS project_id;

-- ========== ADD facility_id COLUMNS ==========
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'facility_id') THEN
    ALTER TABLE assets ADD COLUMN facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'locations' AND column_name = 'facility_id') THEN
    ALTER TABLE locations ADD COLUMN facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'systems' AND column_name = 'facility_id') THEN
    ALTER TABLE systems ADD COLUMN facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tags' AND column_name = 'facility_id') THEN
    ALTER TABLE tags ADD COLUMN facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_posts' AND column_name = 'facility_id') THEN
    ALTER TABLE activity_posts ADD COLUMN facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'asset_import_batches' AND column_name = 'facility_id') THEN
    ALTER TABLE asset_import_batches ADD COLUMN facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ========== ADD NEW UNIQUE CONSTRAINTS ==========
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_facility_id_name_key') THEN
    ALTER TABLE tags ADD CONSTRAINT tags_facility_id_name_key UNIQUE (facility_id, name);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_import_batches_facility_id_source_fingerprint_key') THEN
    ALTER TABLE asset_import_batches ADD CONSTRAINT asset_import_batches_facility_id_source_fingerprint_key
      UNIQUE (facility_id, source_fingerprint);
  END IF;
END $$;

-- ========== CREATE get_asset_facility_id ==========
CREATE OR REPLACE FUNCTION get_asset_facility_id(p_asset_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT facility_id FROM assets WHERE id = p_asset_id;
$$;

REVOKE ALL ON FUNCTION get_asset_facility_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_asset_facility_id(uuid) TO authenticated;

-- ========== INDEXES ==========
CREATE INDEX IF NOT EXISTS idx_assets_facility_id ON assets(facility_id);
CREATE INDEX IF NOT EXISTS idx_locations_facility_id ON locations(facility_id);
CREATE INDEX IF NOT EXISTS idx_systems_facility_id ON systems(facility_id);
CREATE INDEX IF NOT EXISTS idx_tags_facility_id ON tags(facility_id);
CREATE INDEX IF NOT EXISTS idx_activity_posts_facility_id ON activity_posts(facility_id);
CREATE INDEX IF NOT EXISTS idx_asset_import_batches_facility_id ON asset_import_batches(facility_id);
