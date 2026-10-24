/*
# Fix accepted invitations that lack memberships

## Problem
Some facility invitations were marked as "accepted" but the corresponding
organization_members and facility_members rows were never created (likely
due to a partial failure in accept_pending_facility_invitations).

## Changes
1. Data fix: for every invitation marked "accepted" where the user exists
   but has no facility_member row, insert the missing org + facility memberships.
2. Function update: update accept_pending_facility_invitations to also
   re-process "accepted" invitations that lack a facility_member row, 
   preventing this gap in the future.

## Security
- No RLS changes.
- Function remains SECURITY DEFINER with search_path = 'public'.
*/

-- 1. Data fix: backfill missing memberships for accepted invitations
DO $$
DECLARE
  v_inv RECORD;
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  FOR v_inv IN
    SELECT fi.id, fi.email, fi.facility_id, fi.role
    FROM facility_invitations fi
    WHERE fi.status = 'accepted'
  LOOP
    -- Find the user by email
    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE lower(au.email) = lower(v_inv.email)
    LIMIT 1;

    IF v_user_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Check if facility_member row exists
    IF EXISTS (
      SELECT 1 FROM facility_members
      WHERE facility_id = v_inv.facility_id AND user_id = v_user_id
    ) THEN
      CONTINUE;
    END IF;

    -- Get the org for this facility
    SELECT organization_id INTO v_org_id
    FROM facilities
    WHERE id = v_inv.facility_id;

    IF v_org_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Insert missing org membership
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    -- Insert missing facility membership
    INSERT INTO facility_members (facility_id, user_id, role)
    VALUES (v_inv.facility_id, v_user_id, v_inv.role)
    ON CONFLICT (facility_id, user_id)
    DO UPDATE SET role = EXCLUDED.role;

    RAISE NOTICE 'Backfilled memberships for % at facility %', v_inv.email, v_inv.facility_id;
  END LOOP;
END $$;

-- 2. Update the function to also catch accepted-but-missing invitations
CREATE OR REPLACE FUNCTION public.accept_pending_facility_invitations()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(COALESCE(auth.jwt() ->> 'email', ''));
  v_inv record;
  v_count integer := 0;
  v_org_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Process pending invitations (normal flow)
  FOR v_inv IN
    SELECT id, facility_id, role
    FROM facility_invitations
    WHERE lower(email) = v_email
      AND status = 'pending'
    FOR UPDATE
  LOOP
    SELECT organization_id INTO v_org_id
    FROM facilities
    WHERE id = v_inv.facility_id;

    IF v_org_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO facility_members (facility_id, user_id, role)
    VALUES (v_inv.facility_id, v_user_id, v_inv.role)
    ON CONFLICT (facility_id, user_id)
    DO UPDATE SET role = EXCLUDED.role;

    UPDATE facility_invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = v_inv.id;

    v_count := v_count + 1;
  END LOOP;

  -- Also fix accepted invitations that lack a facility_member row
  FOR v_inv IN
    SELECT id, facility_id, role
    FROM facility_invitations
    WHERE lower(email) = v_email
      AND status = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM facility_members fm
        WHERE fm.facility_id = facility_invitations.facility_id
          AND fm.user_id = v_user_id
      )
  LOOP
    SELECT organization_id INTO v_org_id
    FROM facilities
    WHERE id = v_inv.facility_id;

    IF v_org_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO facility_members (facility_id, user_id, role)
    VALUES (v_inv.facility_id, v_user_id, v_inv.role)
    ON CONFLICT (facility_id, user_id)
    DO UPDATE SET role = EXCLUDED.role;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
