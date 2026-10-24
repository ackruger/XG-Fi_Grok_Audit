/*
# Drop bootstrap_org_admin function

## Summary
Removes the `bootstrap_org_admin()` function that allowed any authenticated user
to self-claim admin on an organization with zero members. This was a security
risk: an arbitrary user could claim admin on the seeded "Novus Entertainment Inc."
organization simply by being the first authenticated user to press a button.

## Changes
- Drops the `bootstrap_org_admin(uuid)` function.

## Security
- Eliminates the self-claim vector for existing organizations.
- New organization creation via `create_organization()` remains intact and continues
  to atomically assign the creator as admin.

## Notes
1. The `create_organization()` SECURITY DEFINER function is the only approved path
   for becoming an organization admin: you must create the org yourself.
2. Admin assignment to existing organizations (like Novus) must be done via a
   privileged migration, not a self-service function.
*/

DROP FUNCTION IF EXISTS bootstrap_org_admin(uuid);
