/*
# Create Facility Members and Facility Invitations Tables

1. New Tables
   - `facility_members`
     - `id` (uuid, primary key)
     - `facility_id` (uuid, FK → facilities, ON DELETE CASCADE)
     - `user_id` (uuid, FK → auth.users, ON DELETE CASCADE)
     - `role` (text, CHECK viewer/contributor/reviewer/supervisor/admin)
     - `joined_at` (timestamptz)
     - UNIQUE(facility_id, user_id)

   - `facility_invitations`
     - `id` (uuid, primary key)
     - `facility_id` (uuid, FK → facilities, ON DELETE CASCADE)
     - `email` (text, not null)
     - `role` (text, CHECK viewer/contributor/reviewer/supervisor/admin)
     - `invited_by` (uuid, FK → auth.users)
     - `status` (text, CHECK pending/accepted/declined)
     - `created_at`, `accepted_at` (timestamptz)

2. Security
   - RLS enabled on both. Policies added in migration 034.

3. Notes
   - Organization membership does NOT automatically grant Facility access.
   - Org admins get explicit Facility access through RLS policy (not membership rows).
   - Facility roles: viewer (read), contributor (read+write), reviewer, supervisor, admin.
*/

CREATE TABLE IF NOT EXISTS facility_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'contributor', 'reviewer', 'supervisor', 'admin')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id, user_id)
);

ALTER TABLE facility_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS facility_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'contributor', 'reviewer', 'supervisor', 'admin')),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

ALTER TABLE facility_invitations ENABLE ROW LEVEL SECURITY;
