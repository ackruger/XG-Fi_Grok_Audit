/*
# Create Organizations Table

1. New Tables
   - `organizations`
     - `id` (uuid, primary key)
     - `name` (text, not null) — the organization/company name
     - `description` (text, nullable)
     - `is_active` (boolean, default true)
     - `created_at` (timestamptz)
     - `updated_at` (timestamptz)

2. Security
   - RLS enabled on `organizations`.
   - Policies will be added after security helper functions are created (migration 033/034).

3. Seed Data
   - Creates initial organization "Novus Entertainment Inc."

4. Notes
   - This is the top-level container in the hierarchy: Organization → Facility → Asset.
   - Organization membership and RLS are handled in subsequent migrations.
   - No policies yet — the table is locked until migration 034.
*/

-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Seed initial organization
INSERT INTO organizations (name, description)
VALUES ('Novus Entertainment Inc.', 'Primary organization')
ON CONFLICT DO NOTHING;
