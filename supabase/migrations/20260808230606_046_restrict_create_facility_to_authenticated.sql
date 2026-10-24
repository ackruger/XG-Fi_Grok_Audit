/*
# Restrict create_facility execute to authenticated only

## Summary
Revokes EXECUTE on create_facility from anon and public roles.
The initial migration's REVOKE FROM PUBLIC did not override the default
grant that Supabase applies to new functions. This migration explicitly
revokes from both anon and public to ensure only authenticated users
can call this function.

## Security
- Only authenticated users can call create_facility().
- The function's internal auth.uid() check provides a second layer of defense.
*/

REVOKE EXECUTE ON FUNCTION create_facility(text, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION create_facility(text, uuid, text, text) FROM PUBLIC;
