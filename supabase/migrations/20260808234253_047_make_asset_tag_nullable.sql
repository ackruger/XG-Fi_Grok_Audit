/*
# Make asset_tag nullable

## Summary
Changes `assets.asset_tag` from NOT NULL (with default '') to nullable.
This allows untagged assets (e.g. MEDICAL GAS MANIFOLDS) to be imported
with asset_tag = NULL rather than failing with a not-null constraint violation.

## Changes
- ALTER COLUMN asset_tag DROP NOT NULL
- ALTER COLUMN asset_tag DROP DEFAULT (removes the '' default so NULL is the natural absent state)

## Security
- No RLS or privilege changes.
- Existing non-null asset_tag values are preserved.

## Notes
1. There is no unique index on asset_tag, so NULL values create no uniqueness issues.
2. Empty string values ('') already in the table are not converted to NULL;
   they remain as-is since they represent previously imported data.
3. The import engine already handles `asset.assetTag || null` at insert time (line 373),
   so this migration just removes the schema constraint that prevented it from working.
*/

ALTER TABLE assets ALTER COLUMN asset_tag DROP NOT NULL;
ALTER TABLE assets ALTER COLUMN asset_tag DROP DEFAULT;
