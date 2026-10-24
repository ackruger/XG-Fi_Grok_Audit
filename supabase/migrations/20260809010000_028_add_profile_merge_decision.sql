/*
# Add profile_merge import decision type

## Modified Tables
### asset_import_records
  - CHECK constraint expanded to include 'profile_merge'.
*/

ALTER TABLE asset_import_records
  DROP CONSTRAINT IF EXISTS asset_import_records_import_decision_check;

ALTER TABLE asset_import_records
  ADD CONSTRAINT asset_import_records_import_decision_check
  CHECK (import_decision IN ('ready', 'review', 'exclude', 'profile_merge'));
