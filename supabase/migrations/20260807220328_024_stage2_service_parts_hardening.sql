/*
# Stage 2.1 — Service Parts Hardening

1. Modified Tables
   - `asset_service_parts`
     - Added `part_type` (text, nullable) — categorises the part (e.g. Filter, Belt, Consumable)
     - Added `size` (text, nullable) — physical size descriptor (e.g. 20x25x2)
     - Added `service_interval_days` (integer, nullable, >= 0) — how often the part should be serviced/replaced, distinct from lead_time_days which is procurement time

2. Constraints
   - CHECK constraint ensures service_interval_days cannot be negative

3. Important Notes
   - lead_time_days = how long to obtain the part
   - service_interval_days = how often the part needs servicing/replacement
   - These are intentionally separate fields with different meanings
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_service_parts' AND column_name = 'part_type'
  ) THEN
    ALTER TABLE asset_service_parts ADD COLUMN part_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_service_parts' AND column_name = 'size'
  ) THEN
    ALTER TABLE asset_service_parts ADD COLUMN size text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_service_parts' AND column_name = 'service_interval_days'
  ) THEN
    ALTER TABLE asset_service_parts ADD COLUMN service_interval_days integer;
  END IF;
END $$;

ALTER TABLE asset_service_parts
  DROP CONSTRAINT IF EXISTS service_interval_days_non_negative;
ALTER TABLE asset_service_parts
  ADD CONSTRAINT service_interval_days_non_negative CHECK (service_interval_days >= 0);
