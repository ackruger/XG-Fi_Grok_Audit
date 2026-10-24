/*
# Add foreign key from facility_members to profiles

## Problem
The Team page joins facility_members -> profiles via PostgREST's embedded resource syntax,
but the only FK on facility_members.user_id points to auth.users. PostgREST cannot resolve
the profiles(...) join, so the query returns null profile data and members appear missing.

## Changes
- Add a second FK from facility_members.user_id referencing profiles.id.
  This lets PostgREST resolve `.select('..., profiles(...)')` automatically.

## Notes
1. The existing FK to auth.users is preserved (cascade delete still works).
2. This FK is purely for PostgREST join resolution; both FKs reference the same uuid.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'facility_members_user_id_profiles_fk'
  ) THEN
    ALTER TABLE facility_members
      ADD CONSTRAINT facility_members_user_id_profiles_fk
      FOREIGN KEY (user_id) REFERENCES profiles(id);
  END IF;
END $$;
