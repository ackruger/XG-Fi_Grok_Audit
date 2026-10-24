/*
# Stage 1 Attribute Integrity — database-level validation for attribute values

## Overview
Adds a trigger on `asset_attribute_values` that enforces three integrity rules
at the database level, preventing invalid data regardless of client behaviour:

A. The attribute definition must belong to the asset type assigned to the asset.
   An AHU asset cannot hold a Pump-only attribute value.

B. If a design profile is supplied, that profile must belong to the same asset.
   Asset A cannot reference a design profile that belongs to Asset B.

C. The attribute definition's asset type must belong to the same project as the asset.
   Cross-project attribute assignments are rejected.

## Changes

1. New function `check_attribute_value_integrity()`
   - SECURITY DEFINER trigger function on `asset_attribute_values`
   - Validates rules A, B, and C on INSERT and UPDATE
   - Raises descriptive exceptions on violation

2. New trigger `enforce_attribute_value_integrity` on `asset_attribute_values`
   - Fires BEFORE INSERT OR UPDATE
   - FOR EACH ROW

## Security
- SECURITY DEFINER so the function can read asset/type/profile data
  regardless of caller's RLS context.
- No RLS policy changes.

## Notes
- Rule A allows attribute values when the asset has no asset_type_id (NULL).
  This supports legacy assets that predate the type system. Once an asset
  is assigned a type, only that type's definitions are accepted.
- These checks complement the existing partial unique indexes (base and
  profile-scoped) which remain in place.
*/

CREATE OR REPLACE FUNCTION check_attribute_value_integrity()
RETURNS trigger AS $$
DECLARE
  v_asset_type_id uuid;
  v_asset_project_id uuid;
  v_def_type_id uuid;
  v_def_type_project_id uuid;
  v_profile_asset_id uuid;
BEGIN
  -- Look up the asset's type and project
  SELECT asset_type_id, project_id
    INTO v_asset_type_id, v_asset_project_id
    FROM assets
   WHERE id = NEW.asset_id;

  IF v_asset_project_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found: %', NEW.asset_id;
  END IF;

  -- Look up the attribute definition's asset type and that type's project
  SELECT aad.asset_type_id, at.project_id
    INTO v_def_type_id, v_def_type_project_id
    FROM asset_attribute_definitions aad
    JOIN asset_types at ON at.id = aad.asset_type_id
   WHERE aad.id = NEW.attribute_definition_id;

  IF v_def_type_id IS NULL THEN
    RAISE EXCEPTION 'Attribute definition not found: %', NEW.attribute_definition_id;
  END IF;

  -- Rule C: project consistency
  IF v_def_type_project_id != v_asset_project_id THEN
    RAISE EXCEPTION 'Attribute definition belongs to a different project than the asset';
  END IF;

  -- Rule A: type consistency (skip if asset has no type assigned yet)
  IF v_asset_type_id IS NOT NULL AND v_asset_type_id != v_def_type_id THEN
    RAISE EXCEPTION 'Attribute definition belongs to asset type % but asset is type %',
      v_def_type_id, v_asset_type_id;
  END IF;

  -- Rule B: design profile must belong to the same asset
  IF NEW.design_profile_id IS NOT NULL THEN
    SELECT asset_id INTO v_profile_asset_id
      FROM asset_design_profiles
     WHERE id = NEW.design_profile_id;

    IF v_profile_asset_id IS NULL THEN
      RAISE EXCEPTION 'Design profile not found: %', NEW.design_profile_id;
    END IF;

    IF v_profile_asset_id != NEW.asset_id THEN
      RAISE EXCEPTION 'Design profile % belongs to asset % but value references asset %',
        NEW.design_profile_id, v_profile_asset_id, NEW.asset_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_attribute_value_integrity ON asset_attribute_values;
CREATE TRIGGER enforce_attribute_value_integrity
  BEFORE INSERT OR UPDATE ON asset_attribute_values
  FOR EACH ROW EXECUTE FUNCTION check_attribute_value_integrity();
