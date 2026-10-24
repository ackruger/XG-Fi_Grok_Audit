/*
# Add profile_merge import decision type

## Purpose
The import_decision column on asset_import_records needs a fourth value: 'profile_merge'.
This replaces the misleading 'exclude' label for heating-counterpart rows in HC-CC profile
pairs. These rows do NOT get excluded — their data creates a Heating Performance design
profile on the corresponding physical asset.

## Modified Tables

### asset_import_records
  - CHECK constraint on import_decision expanded from ('ready', 'review', 'exclude')
    to ('ready', 'review', 'exclude', 'profile_merge').

## Security
  - No policy changes.
*/

ALTER TABLE asset_import_records
  DROP CONSTRAINT IF EXISTS asset_import_records_import_decision_check;

ALTER TABLE asset_import_records
  ADD CONSTRAINT asset_import_records_import_decision_check
  CHECK (import_decision IN ('ready', 'review', 'exclude', 'profile_merge'));
