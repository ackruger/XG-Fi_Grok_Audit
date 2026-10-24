/*
# Assign Alfred Kruger as initial admin of Novus Entertainment Inc.

## Summary
Inserts Alfred Kruger (alfred.kruger@gmail.com, profile id 79c5e377-14a5-44da-aa65-814bf59218b4)
as the admin member of the seeded Novus Entertainment Inc. organization
(id a910e916-92f9-4c86-8e6b-ceed14bcd0a0).

This is a one-time privileged data seed — no self-service bootstrap path exists.
The bootstrap_org_admin() function was dropped in a prior migration.

## Changes
- Inserts one row into `organization_members` with role = 'admin'.

## Security
- This migration runs with superuser privileges, bypassing RLS intentionally.
- No self-claim or self-bootstrap path is exposed to end users.
- Only an existing org admin can add further members via the app's RLS policies.

## Notes
1. Idempotent: uses ON CONFLICT DO NOTHING so re-running is safe.
2. Jay Willows is intentionally NOT assigned.
*/

INSERT INTO organization_members (organization_id, user_id, role)
VALUES (
  'a910e916-92f9-4c86-8e6b-ceed14bcd0a0',
  '79c5e377-14a5-44da-aa65-814bf59218b4',
  'admin'
)
ON CONFLICT DO NOTHING;
