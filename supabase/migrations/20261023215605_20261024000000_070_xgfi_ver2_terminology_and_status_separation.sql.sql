/*
# Xg-Fi Ver2: Terminology and Status Separation

## Purpose
Separates overloaded asset concepts into distinct fields so that "status" no longer carries
multiple meanings. Reuses existing columns where compatible (asset_tag → Asset ID, design_stage
→ lifecycle stage area, area_served → system served) and adds only what is missing.

## New Columns on `assets`
1. `alias` (text, nullable) — human-friendly alternate name for the asset
2. `operational_status` (text, NOT NULL, default 'active') — Active | Shut Down | Pending
3. `lifecycle_stage` (text, nullable) — Received | Installed | Commissioned | Warranty
4. `identification_status` (text, NOT NULL, default 'identified') — Identified | Unidentified | Needs Review
5. `criticality` (text, nullable) — user-assigned criticality level (e.g. critical, non-critical)
6. `static_notes` (text, nullable) — permanent design/spec notes that don't change with operations
7. `trades` (text[], nullable) — list of trade codes/names associated with the asset
8. `system_served` (text, nullable) — free-text system served (distinct from system_id FK)
9. `bim_x` (double precision, nullable) — BIM X coordinate
10. `bim_y` (double precision, nullable) — BIM Y coordinate
11. `bim_z` (double precision, nullable) — BIM Z coordinate
12. `gridline` (text, nullable) — gridline reference for location
13. `zone` (text, nullable) — zone within facility
14. `space` (text, nullable) — space designation within zone
15. `level` (text, nullable) — level/floor (distinct from location.floor, user-editable)
16. `checklist_focus` (text, nullable) — current checklist progress focus (e.g. rough-in, startup, commissioning)

## New Columns on `locations`
1. `gridline` (text, nullable) — gridline reference
2. `zone` (text, nullable) — zone designation
3. `space` (text, nullable) — space designation

## Existing column reuse
- `asset_tag` → Asset ID (already exists)
- `equipment_name` → display name (already exists)
- `equipment_type` → Asset Type text (already exists, supplemented by `asset_type_id` FK)
- `status` → retained for backward compatibility (existing dashboard still reads it)
- `design_stage` → retained; `lifecycle_stage` is the new structured field
- `area_served` → retained; `system_served` is the new structured field
- `notes` → retained as operational notes; `static_notes` is the new permanent-notes field

## Security
- No new tables, so no new RLS policies needed.
- Existing RLS on `assets` and `locations` continues to govern access.
- Grants updated to include new columns automatically (table-level grants cover all columns).

## Notes
1. The existing `status` column is NOT removed or altered — existing dashboard and activity
   code continues to work. The new `operational_status`, `lifecycle_stage`, and
   `identification_status` fields are the structured replacements going forward.
2. Z coordinate defaults to NULL in the database. The UI may display 0 when absent,
   but the database preserves unknown source data as NULL (never overwrites with 0).
3. `trades` is a text array to support multiple trades on one asset without a join table.
4. All columns are additive — no existing data is changed or lost.
5. Idempotent: uses IF NOT EXISTS for all ALTER TABLE ADD COLUMN statements.
*/

-- Add new columns to assets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'alias') THEN
    ALTER TABLE assets ADD COLUMN alias text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'operational_status') THEN
    ALTER TABLE assets ADD COLUMN operational_status text NOT NULL DEFAULT 'active'
      CHECK (operational_status IN ('active', 'shut_down', 'pending'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'lifecycle_stage') THEN
    ALTER TABLE assets ADD COLUMN lifecycle_stage text
      CHECK (lifecycle_stage IS NULL OR lifecycle_stage IN ('received', 'installed', 'commissioned', 'warranty'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'identification_status') THEN
    ALTER TABLE assets ADD COLUMN identification_status text NOT NULL DEFAULT 'identified'
      CHECK (identification_status IN ('identified', 'unidentified', 'needs_review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'criticality') THEN
    ALTER TABLE assets ADD COLUMN criticality text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'static_notes') THEN
    ALTER TABLE assets ADD COLUMN static_notes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'trades') THEN
    ALTER TABLE assets ADD COLUMN trades text[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'system_served') THEN
    ALTER TABLE assets ADD COLUMN system_served text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'bim_x') THEN
    ALTER TABLE assets ADD COLUMN bim_x double precision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'bim_y') THEN
    ALTER TABLE assets ADD COLUMN bim_y double precision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'bim_z') THEN
    ALTER TABLE assets ADD COLUMN bim_z double precision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'gridline') THEN
    ALTER TABLE assets ADD COLUMN gridline text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'zone') THEN
    ALTER TABLE assets ADD COLUMN zone text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'space') THEN
    ALTER TABLE assets ADD COLUMN space text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'level') THEN
    ALTER TABLE assets ADD COLUMN level text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'checklist_focus') THEN
    ALTER TABLE assets ADD COLUMN checklist_focus text;
  END IF;
END $$;

-- Add new columns to locations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'locations' AND column_name = 'gridline') THEN
    ALTER TABLE locations ADD COLUMN gridline text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'locations' AND column_name = 'zone') THEN
    ALTER TABLE locations ADD COLUMN zone text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'locations' AND column_name = 'space') THEN
    ALTER TABLE locations ADD COLUMN space text;
  END IF;
END $$;

-- Add indexes for the new filterable columns
CREATE INDEX IF NOT EXISTS idx_assets_operational_status ON assets(operational_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_identification_status ON assets(identification_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_lifecycle_stage ON assets(lifecycle_stage) WHERE deleted_at IS NULL AND lifecycle_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_checklist_focus ON assets(checklist_focus) WHERE deleted_at IS NULL AND checklist_focus IS NOT NULL;
