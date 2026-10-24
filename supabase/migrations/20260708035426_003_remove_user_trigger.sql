/*
# Remove handle_new_user trigger

The AFTER INSERT trigger on auth.users was causing "Database error saving new user"
failures during signup. Profile creation is now handled client-side in the AuthContext
via upsert after successful authentication.

## Changes
- Drop the trigger on auth.users
- Drop the trigger function
*/

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
