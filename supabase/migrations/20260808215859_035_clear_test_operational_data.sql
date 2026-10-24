/*
# Clear Test Operational Data

Removes all disposable test/project operational data in FK dependency order.
This is safe because:
- All existing project/asset data is test data only
- No production asset register has been imported
- auth.users and profiles are NOT touched
- trades (global lookup) is NOT touched

Tables cleared (in dependency order):
1. Child records: comments, status_history, photos, asset_notes, asset_tags,
   asset_attribute_values, asset_design_profiles, asset_relationships,
   asset_service_parts, asset_documents, asset_import_records
2. Mid-level: events, issues, activity_posts, asset_import_batches
3. Assets
4. Lookups: locations, systems, tags, asset_types
5. Project membership: project_invitations, project_members
6. Projects themselves

Record counts being cleared:
- events: 17, issues: 13, assets: 22, locations: 7, tags: 4,
  systems: 1, project_invitations: 2, project_members: 5, projects: 5
- All other operational tables: 0 rows

NOT cleared: auth.users, profiles (2 rows), trades
*/

-- Level 1: deepest children (no other table references these)
DELETE FROM comments;
DELETE FROM status_history;
DELETE FROM photos;
DELETE FROM asset_notes;
DELETE FROM asset_tags;
DELETE FROM asset_attribute_values;
DELETE FROM asset_design_profiles;
DELETE FROM asset_relationships;
DELETE FROM asset_service_parts;
DELETE FROM asset_documents;
DELETE FROM asset_import_records;

-- Level 2: mid-level (referenced by level 1)
DELETE FROM events;
DELETE FROM issues;
DELETE FROM activity_posts;
DELETE FROM asset_import_batches;

-- Level 3: assets (referenced by events, issues, etc.)
DELETE FROM assets;

-- Level 4: facility-scoped lookups (referenced by assets)
DELETE FROM locations;
DELETE FROM systems;
DELETE FROM tags;
DELETE FROM asset_types;

-- Level 5: project membership (no longer needed)
DELETE FROM project_invitations;
DELETE FROM project_members;

-- Level 6: projects themselves
DELETE FROM projects;
