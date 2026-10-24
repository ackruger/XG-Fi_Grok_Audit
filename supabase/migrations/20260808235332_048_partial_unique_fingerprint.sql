/*
# Replace hard fingerprint uniqueness with partial unique index

## Summary
The previous UNIQUE constraint on (facility_id, source_fingerprint) blocked reimport
of a CSV even after its batch was rolled back. This migration replaces the unconditional
constraint with a partial unique index that only enforces uniqueness for active batches
(status = 'in_progress' or 'completed'). Rolled-back and failed batches are preserved
as audit history and do not block reimport.

## Changes
- DROP the hard UNIQUE constraint `asset_import_batches_facility_id_source_fingerprint_key`.
- CREATE a partial unique index `idx_import_batches_active_fingerprint`
  on (facility_id, source_fingerprint) WHERE status IN ('in_progress', 'completed').

## Duplicate-protection behaviour after this migration
- Same CSV + same facility + completed batch   → BLOCKED
- Same CSV + same facility + in_progress batch → BLOCKED
- Same CSV + same facility + rolled_back batch → ALLOWED
- Same CSV + same facility + failed batch      → ALLOWED
- Same CSV + different facility                → ALLOWED

## Security
- No RLS or privilege changes.

## Notes
1. Existing rolled-back / failed batch records are preserved as audit history.
2. The application-level check in `checkDuplicateImport()` already filters by
   status IN ('completed', 'in_progress'), so it already agrees with this rule.
3. The DROP + CREATE are idempotent: the constraint is dropped only IF EXISTS,
   and the index is created only IF NOT EXISTS.
*/

-- Remove the unconditional unique constraint
ALTER TABLE asset_import_batches
  DROP CONSTRAINT IF EXISTS asset_import_batches_facility_id_source_fingerprint_key;

-- Also drop the backing index if it was left behind
DROP INDEX IF EXISTS asset_import_batches_facility_id_source_fingerprint_key;

-- Create a partial unique index that only blocks active / successful batches
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_active_fingerprint
  ON asset_import_batches (facility_id, source_fingerprint)
  WHERE status IN ('in_progress', 'completed');
