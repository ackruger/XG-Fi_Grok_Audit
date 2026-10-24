/*
# Fix handle_new_user trigger function

The trigger was failing with "Database error saving new user" because it needs
explicit schema qualification and proper search_path settings to reliably insert
into public.profiles from within the auth schema context.

## Changes
- Recreate handle_new_user function with SET search_path
- Explicitly qualify public.profiles in the INSERT
- Add exception handling to prevent user creation from failing entirely
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
