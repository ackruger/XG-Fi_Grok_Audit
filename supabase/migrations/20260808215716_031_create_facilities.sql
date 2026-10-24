/*
# Create Facilities Table

1. New Tables
   - `facilities`
     - `id` (uuid, primary key)
     - `organization_id` (uuid, FK → organizations, ON DELETE CASCADE)
     - `name` (text, not null) — only required business field
     - `code` (text, nullable) — optional short code
     - `description` (text, nullable)
     - `address_line_1` through `country` — optional address fields
     - `is_active` (boolean, default true)
     - `created_at`, `updated_at` (timestamptz)

2. Security
   - RLS enabled. Policies added in migration 034.

3. Notes
   - Facility is a permanent physical site/location containing assets.
   - Only `name` is required; all address fields are optional.
   - Hierarchy: Organization → Facility → Location → Asset
*/

CREATE TABLE IF NOT EXISTS facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  description text,
  address_line_1 text,
  address_line_2 text,
  city text,
  province_state text,
  postal_code text,
  country text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
