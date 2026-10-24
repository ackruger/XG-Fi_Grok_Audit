/*
# Stage 1 Hardening — database-level project integrity constraints

## Overview
Adds database-level enforcement that both assets in a relationship must
belong to the same project. Previously this was only enforced by
application-level logic and RLS. A trigger function now rejects
cross-project relationships at INSERT and UPDATE time.

## Changes

1. New function `check_relationship_same_project()`
   - SECURITY DEFINER trigger function
   - On INSERT or UPDATE of `asset_relationships`, verifies that both
     source_asset_id and target_asset_id reference assets in the same project.
   - Raises an exception if projects differ.

2. New trigger `enforce_same_project_relationship` on `asset_relationships`
   - Fires BEFORE INSERT OR UPDATE
   - Calls the check function

## Security
- The trigger function uses SECURITY DEFINER to read asset project_ids
  regardless of the caller's RLS context, ensuring the check always runs.
- No RLS policy changes.

## Notes
- The existing CHECK constraint (source_asset_id != target_asset_id)
  preventing self-references remains in place.
- This trigger runs in addition to RLS, providing defense-in-depth.
*/

CREATE OR REPLACE FUNCTION check_relationship_same_project()
RETURNS trigger AS $$
DECLARE
  source_project uuid;
  target_project uuid;
BEGIN
  SELECT project_id INTO source_project FROM assets WHERE id = NEW.source_asset_id;
  SELECT project_id INTO target_project FROM assets WHERE id = NEW.target_asset_id;

  IF source_project IS NULL THEN
    RAISE EXCEPTION 'Source asset not found: %', NEW.source_asset_id;
  END IF;

  IF target_project IS NULL THEN
    RAISE EXCEPTION 'Target asset not found: %', NEW.target_asset_id;
  END IF;

  IF source_project != target_project THEN
    RAISE EXCEPTION 'Cannot create relationship between assets in different projects (source project: %, target project: %)', source_project, target_project;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_same_project_relationship ON asset_relationships;
CREATE TRIGGER enforce_same_project_relationship
  BEFORE INSERT OR UPDATE ON asset_relationships
  FOR EACH ROW EXECUTE FUNCTION check_relationship_same_project();
