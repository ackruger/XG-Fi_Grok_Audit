/*
# Create project_invitations table

1. New Tables
  - `project_invitations`
    - `id` (uuid, primary key)
    - `project_id` (uuid, FK → projects)
    - `email` (text, not null) — email of the invitee
    - `role` (text, not null) — role to assign on acceptance
    - `invited_by` (uuid, FK → profiles) — who sent the invite
    - `status` (text, default 'pending') — pending / accepted / declined
    - `created_at` (timestamptz)
    - `accepted_at` (timestamptz, nullable)

2. Security
  - Enable RLS on `project_invitations`
  - Project admins/supervisors can create, view, update, and delete invitations
  - Invitees can view their own invitations (by email match via auth.jwt())

3. Constraints
  - Role must be one of: viewer, contributor, reviewer, supervisor, admin
  - Status must be one of: pending, accepted, declined
  - Unique constraint on (project_id, email, status='pending') to prevent duplicate pending invites
*/

CREATE TABLE IF NOT EXISTS project_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'contributor' CHECK (role IN ('viewer', 'contributor', 'reviewer', 'supervisor', 'admin')),
  invited_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_invitation
  ON project_invitations (project_id, email)
  WHERE status = 'pending';

ALTER TABLE project_invitations ENABLE ROW LEVEL SECURITY;

-- Admins/supervisors of the project can see all invitations for that project
-- Users can also see invitations addressed to their own email
DROP POLICY IF EXISTS "select_project_invitations" ON project_invitations;
CREATE POLICY "select_project_invitations" ON project_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = project_invitations.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('supervisor', 'admin')
    )
    OR (auth.jwt() ->> 'email') = email
  );

-- Admins/supervisors can create invitations
DROP POLICY IF EXISTS "insert_project_invitations" ON project_invitations;
CREATE POLICY "insert_project_invitations" ON project_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = project_invitations.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('supervisor', 'admin')
    )
  );

-- Admins/supervisors can update invitations (e.g. cancel)
-- OR the invitee can update their own invitation (accept/decline)
DROP POLICY IF EXISTS "update_project_invitations" ON project_invitations;
CREATE POLICY "update_project_invitations" ON project_invitations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = project_invitations.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('supervisor', 'admin')
    )
    OR (auth.jwt() ->> 'email') = email
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = project_invitations.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('supervisor', 'admin')
    )
    OR (auth.jwt() ->> 'email') = email
  );

-- Admins/supervisors can delete invitations
DROP POLICY IF EXISTS "delete_project_invitations" ON project_invitations;
CREATE POLICY "delete_project_invitations" ON project_invitations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = project_invitations.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('supervisor', 'admin')
    )
  );
