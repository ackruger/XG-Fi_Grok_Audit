/*
# Correct invitation email validation
1. Changes
- Correct the email pattern in the administrator-only invitation creation function so ordinary email addresses are accepted.
- No user records or existing memberships are changed.
2. Security
- Preserve administrator authorization, normalized email checks, duplicate protection, and restricted execution grants.
*/
CREATE OR REPLACE FUNCTION public.create_facility_invitation(p_facility_id uuid,p_email text,p_role text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_email text:=lower(trim(p_email));
BEGIN
IF auth.uid() IS NULL OR public.get_facility_role(p_facility_id,auth.uid()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR p_role IS NULL OR p_role NOT IN ('viewer','contributor','reviewer','supervisor','admin') THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||v_email,0));
IF EXISTS(SELECT 1 FROM public.facility_invitations WHERE facility_id=p_facility_id AND lower(email)=v_email AND status='pending') THEN RAISE EXCEPTION 'Pending invitation exists' USING ERRCODE='23505'; END IF;
IF EXISTS(SELECT 1 FROM public.facility_members fm JOIN auth.users u ON u.id=fm.user_id WHERE fm.facility_id=p_facility_id AND lower(u.email)=v_email) THEN RAISE EXCEPTION 'Already a member' USING ERRCODE='23505'; END IF;
INSERT INTO public.facility_invitations(facility_id,email,role,invited_by) VALUES(p_facility_id,v_email,p_role,auth.uid()) RETURNING id INTO v_id;
RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_facility_invitation(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_facility_invitation(uuid,text,text) TO authenticated;