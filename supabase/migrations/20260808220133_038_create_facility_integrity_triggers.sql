/*
# Create Facility-Based Integrity Triggers

1. New Triggers
   - `check_relationship_same_facility()` — both assets in a relationship must share facility_id
   - `check_asset_system_facility_match()` — asset.facility_id must equal system.facility_id
   - `check_asset_type_org_match()` — asset's facility's organization must equal asset_type's organization
   - Updated `check_attribute_value_integrity()` — preserves all existing checks, adapted for org/facility

2. Notes
   - Replaces the old project-based triggers dropped in migration 037.
   - Database-level enforcement.
*/

-- 1. Same-facility relationship enforcement
CREATE OR REPLACE FUNCTION check_relationship_same_facility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_facility uuid;
  v_target_facility uuid;
BEGIN
  SELECT facility_id INTO v_source_facility FROM assets WHERE id = NEW.source_asset_id;
  SELECT facility_id INTO v_target_facility FROM assets WHERE id = NEW.target_asset_id;

  IF v_source_facility IS DISTINCT FROM v_target_facility THEN
    RAISE EXCEPTION 'Cannot create relationship between assets in different facilities';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_same_facility_relationship ON asset_relationships;
CREATE TRIGGER enforce_same_facility_relationship
  BEFORE INSERT OR UPDATE ON asset_relationships
  FOR EACH ROW
  EXECUTE FUNCTION check_relationship_same_facility();

-- 2. Asset-system facility match
CREATE OR REPLACE FUNCTION check_asset_system_facility_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system_facility uuid;
BEGIN
  IF NEW.system_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT facility_id INTO v_system_facility FROM systems WHERE id = NEW.system_id;

  IF v_system_facility IS DISTINCT FROM NEW.facility_id THEN
    RAISE EXCEPTION 'Asset facility_id must match the assigned system facility_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asset_system_facility_check ON assets;
CREATE TRIGGER trg_asset_system_facility_check
  BEFORE INSERT OR UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION check_asset_system_facility_match();

-- 3. Asset type organization match
CREATE OR REPLACE FUNCTION check_asset_type_org_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facility_org uuid;
  v_type_org uuid;
BEGIN
  IF NEW.asset_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT f.organization_id INTO v_facility_org
  FROM facilities f WHERE f.id = NEW.facility_id;

  SELECT at.organization_id INTO v_type_org
  FROM asset_types at WHERE at.id = NEW.asset_type_id;

  IF v_facility_org IS DISTINCT FROM v_type_org THEN
    RAISE EXCEPTION 'Asset type must belong to the same organization as the asset facility';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asset_type_org_check ON assets;
CREATE TRIGGER trg_asset_type_org_check
  BEFORE INSERT OR UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION check_asset_type_org_match();

-- 4. Updated attribute value integrity trigger
-- Drop old trigger by its actual name first
DROP TRIGGER IF EXISTS enforce_attribute_value_integrity ON asset_attribute_values;
DROP TRIGGER IF EXISTS trg_check_attribute_value_integrity ON asset_attribute_values;
DROP FUNCTION IF EXISTS check_attribute_value_integrity() CASCADE;

CREATE OR REPLACE FUNCTION check_attribute_value_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_type_id uuid;
  v_def_type_id uuid;
  v_def_org_id uuid;
  v_asset_facility_id uuid;
  v_facility_org_id uuid;
  v_profile_asset_id uuid;
BEGIN
  SELECT a.asset_type_id, a.facility_id
  INTO v_asset_type_id, v_asset_facility_id
  FROM assets a WHERE a.id = NEW.asset_id;

  IF v_asset_type_id IS NULL THEN
    RAISE EXCEPTION 'Asset has no asset_type_id — cannot store typed attribute values';
  END IF;

  SELECT d.asset_type_id, at.organization_id
  INTO v_def_type_id, v_def_org_id
  FROM asset_attribute_definitions d
  JOIN asset_types at ON at.id = d.asset_type_id
  WHERE d.id = NEW.attribute_definition_id;

  IF v_def_type_id IS DISTINCT FROM v_asset_type_id THEN
    RAISE EXCEPTION 'Attribute definition does not belong to the asset type';
  END IF;

  SELECT f.organization_id INTO v_facility_org_id
  FROM facilities f WHERE f.id = v_asset_facility_id;

  IF v_facility_org_id IS DISTINCT FROM v_def_org_id THEN
    RAISE EXCEPTION 'Attribute definition organization does not match asset facility organization';
  END IF;

  IF NEW.design_profile_id IS NOT NULL THEN
    SELECT dp.asset_id INTO v_profile_asset_id
    FROM asset_design_profiles dp WHERE dp.id = NEW.design_profile_id;

    IF v_profile_asset_id IS DISTINCT FROM NEW.asset_id THEN
      RAISE EXCEPTION 'Design profile does not belong to this asset';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_attribute_value_integrity
  BEFORE INSERT OR UPDATE ON asset_attribute_values
  FOR EACH ROW
  EXECUTE FUNCTION check_attribute_value_integrity();
