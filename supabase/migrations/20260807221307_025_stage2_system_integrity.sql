/*
# Stage 2.1 — System-Asset Project Integrity

1. New Functions
   - `check_asset_system_project_match()` — trigger function that validates when an asset
     has a system_id, the referenced system must belong to the same project as the asset.
     NULL system_id is allowed.

2. New Triggers
   - `trg_asset_system_project_check` on `assets` — fires BEFORE INSERT OR UPDATE,
     calls the validation function to reject cross-project system references.

3. Important Notes
   - This prevents data integrity issues where Asset in Project A references System in Project B.
   - The FK constraint `assets_system_id_fkey` already ensures the system exists;
     this trigger adds the project-matching requirement.
   - Idempotent: drops existing trigger/function before recreating.
*/

CREATE OR REPLACE FUNCTION check_asset_system_project_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  system_project uuid;
BEGIN
  IF NEW.system_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project_id INTO system_project
  FROM systems
  WHERE id = NEW.system_id;

  IF system_project IS NULL THEN
    RAISE EXCEPTION 'System not found: %', NEW.system_id;
  END IF;

  IF system_project <> NEW.project_id THEN
    RAISE EXCEPTION 'System belongs to a different project. Asset project: %, System project: %',
      NEW.project_id, system_project;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asset_system_project_check ON assets;
CREATE TRIGGER trg_asset_system_project_check
  BEFORE INSERT OR UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION check_asset_system_project_match();
