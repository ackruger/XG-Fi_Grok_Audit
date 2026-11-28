/*
# Secure invitation account setup

## 1. Existing data
Adds first_name and last_name to profiles without changing existing names or users.
Adds hashed invitation tokens, seven-day expiry, and acceptance identity. Existing memberships are retained.
No existing invitation becomes accepted automatically; old pending invitations can be resent by an administrator.

## 2. Invitation lifecycle
Administrator-only functions create, renew and cancel invitations. Renewal rotates a cryptographically random token.
Public lookup returns only the invited email, facility name and expiry for a valid unspent token.
Authenticated acceptance locks the invitation, verifies the provider's email and confirmation, saves names,
and associates the user with the organization and facility without overwriting existing roles.

## 3. Access control
Clients cannot write invitation lifecycle fields or membership roles directly.
Invitation hashes are never readable by clients. Only administrators can list/manage invitation history.
Privileged functions have fixed search paths and explicit execution grants. Anonymous access is limited to token lookup.
Profile writes are limited to user-editable fields; existing login profile creation remains supported.

## 4. Team management
Role changes and removals require an administrator and cannot affect the caller's own membership.
Removal preserves organization-wide membership and other facility access.
*/
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '';
ALTER TABLE public.facility_invitations ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE public.facility_invitations ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days');
ALTER TABLE public.facility_invitations ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id);
CREATE UNIQUE INDEX IF NOT EXISTS facility_invitation_token_hash ON public.facility_invitations(token_hash) WHERE token_hash IS NOT NULL;
ALTER TABLE public.facility_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_invitations FROM anon, authenticated;
GRANT SELECT(id,facility_id,email,role,invited_by,status,created_at,accepted_at,expires_at,accepted_by,revoked_at,revoked_by) ON public.facility_invitations TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.facility_invitations TO service_role;
DROP POLICY IF EXISTS fac_inv_select ON public.facility_invitations;
CREATE POLICY fac_inv_select ON public.facility_invitations FOR SELECT TO authenticated USING (public.get_facility_role(facility_id,auth.uid())='admin');
DROP POLICY IF EXISTS fac_inv_insert ON public.facility_invitations;
CREATE POLICY fac_inv_insert ON public.facility_invitations FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS fac_inv_update ON public.facility_invitations;
CREATE POLICY fac_inv_update ON public.facility_invitations FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS fac_inv_delete ON public.facility_invitations;
CREATE POLICY fac_inv_delete ON public.facility_invitations FOR DELETE TO authenticated USING (false);
REVOKE INSERT,UPDATE,DELETE ON public.facility_members FROM anon,authenticated;
GRANT SELECT ON public.facility_members TO authenticated;
REVOKE INSERT,UPDATE ON public.profiles FROM authenticated;
GRANT INSERT(id,name,email,company,trade,avatar_url,first_name,last_name) ON public.profiles TO authenticated;
GRANT UPDATE(name,email,company,trade,avatar_url,first_name,last_name) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.create_facility_invitation(p_facility_id uuid,p_email text,p_role text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_email text:=lower(trim(p_email));
BEGIN
IF auth.uid() IS NULL OR public.get_facility_role(p_facility_id,auth.uid()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_role IS NULL OR p_role NOT IN ('viewer','contributor','reviewer','supervisor','admin') THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||v_email,0));
IF EXISTS(SELECT 1 FROM public.facility_invitations WHERE facility_id=p_facility_id AND lower(email)=v_email AND status='pending') THEN RAISE EXCEPTION 'Pending invitation exists' USING ERRCODE='23505'; END IF;
IF EXISTS(SELECT 1 FROM public.facility_members fm JOIN auth.users u ON u.id=fm.user_id WHERE fm.facility_id=p_facility_id AND lower(u.email)=v_email) THEN RAISE EXCEPTION 'Already a member' USING ERRCODE='23505'; END IF;
INSERT INTO public.facility_invitations(facility_id,email,role,invited_by) VALUES(p_facility_id,v_email,p_role,auth.uid()) RETURNING id INTO v_id;
RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.issue_facility_invitation_token(p_invitation_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inv public.facility_invitations; v_token text;
BEGIN
SELECT * INTO v_inv FROM public.facility_invitations WHERE id=p_invitation_id FOR UPDATE;
IF NOT FOUND OR auth.uid() IS NULL OR public.get_facility_role(v_inv.facility_id,auth.uid()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
IF v_inv.status<>'pending' THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
v_token:=encode(extensions.gen_random_bytes(32),'hex');
UPDATE public.facility_invitations SET token_hash=encode(extensions.digest(v_token,'sha256'),'hex'),expires_at=now()+interval '7 days' WHERE id=v_inv.id;
RETURN v_token;
END; $$;

CREATE OR REPLACE FUNCTION public.lookup_facility_invitation(p_token text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inv record;
BEGIN
IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
SELECT i.email,i.expires_at,f.name AS facility_name INTO v_inv FROM public.facility_invitations i JOIN public.facilities f ON f.id=i.facility_id WHERE i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND i.status='pending' AND i.expires_at>now() AND f.is_active;
IF NOT FOUND THEN RETURN NULL; END IF;
RETURN jsonb_build_object('email',v_inv.email,'expires_at',v_inv.expires_at,'facility_name',v_inv.facility_name);
END; $$;

CREATE OR REPLACE FUNCTION public.accept_facility_invitation(p_token text,p_first_name text,p_last_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inv public.facility_invitations; v_uid uuid:=auth.uid(); v_email text; v_org uuid; v_first text:=trim(p_first_name); v_last text:=trim(p_last_name);
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR v_first IS NULL OR v_last IS NULL OR length(v_first) NOT BETWEEN 1 AND 100 OR length(v_last) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
SELECT lower(email) INTO v_email FROM auth.users WHERE id=v_uid AND email_confirmed_at IS NOT NULL;
SELECT * INTO v_inv FROM public.facility_invitations WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') FOR UPDATE;
IF NOT FOUND OR v_inv.status<>'pending' OR v_inv.expires_at<=now() OR v_email IS NULL OR lower(v_inv.email)<>v_email THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
SELECT organization_id INTO v_org FROM public.facilities WHERE id=v_inv.facility_id AND is_active;
IF v_org IS NULL THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
INSERT INTO public.profiles(id,email,name,first_name,last_name) VALUES(v_uid,v_email,v_first||' '||v_last,v_first,v_last)
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,email=EXCLUDED.email;
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES(v_org,v_uid,'member') ON CONFLICT(organization_id,user_id) DO NOTHING;
INSERT INTO public.facility_members(facility_id,user_id,role) VALUES(v_inv.facility_id,v_uid,v_inv.role) ON CONFLICT(facility_id,user_id) DO NOTHING;
UPDATE public.facility_invitations SET status='accepted',accepted_at=now(),accepted_by=v_uid WHERE id=v_inv.id;
RETURN jsonb_build_object('facility_id',v_inv.facility_id,'organization_id',v_org);
END; $$;

CREATE OR REPLACE FUNCTION public.accept_pending_facility_invitations() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF; RETURN 0; END; $$;

CREATE OR REPLACE FUNCTION public.revoke_facility_invitation(p_invitation_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inv public.facility_invitations;
BEGIN
SELECT * INTO v_inv FROM public.facility_invitations WHERE id=p_invitation_id FOR UPDATE;
IF NOT FOUND OR auth.uid() IS NULL OR public.get_facility_role(v_inv.facility_id,auth.uid()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
IF v_inv.status<>'pending' THEN RETURN false; END IF;
UPDATE public.facility_invitations SET status='revoked',revoked_at=now(),revoked_by=auth.uid(),token_hash=NULL WHERE id=v_inv.id;
RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.set_facility_member_role(p_member_id uuid,p_role text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_member public.facility_members;
BEGIN
SELECT * INTO v_member FROM public.facility_members WHERE id=p_member_id FOR UPDATE;
IF NOT FOUND OR auth.uid() IS NULL OR v_member.user_id=auth.uid() OR public.get_facility_role(v_member.facility_id,auth.uid()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
IF p_role IS NULL OR p_role NOT IN ('viewer','contributor','reviewer','supervisor','admin') THEN RAISE EXCEPTION 'Invalid role'; END IF;
UPDATE public.facility_members SET role=p_role WHERE id=v_member.id; RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_facility_member(p_member_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_member public.facility_members; v_org uuid; v_role text;
BEGIN
SELECT * INTO v_member FROM public.facility_members WHERE id=p_member_id FOR UPDATE;
IF NOT FOUND OR auth.uid() IS NULL OR v_member.user_id=auth.uid() OR public.get_facility_role(v_member.facility_id,auth.uid()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
SELECT organization_id INTO v_org FROM public.facilities WHERE id=v_member.facility_id;
SELECT role INTO v_role FROM public.organization_members WHERE organization_id=v_org AND user_id=v_member.user_id;
UPDATE public.facility_invitations SET status='revoked',token_hash=NULL,revoked_at=now(),revoked_by=auth.uid() WHERE facility_id=v_member.facility_id AND lower(email)=(SELECT lower(email) FROM auth.users WHERE id=v_member.user_id) AND status='pending';
DELETE FROM public.facility_members WHERE id=v_member.id;
RETURN jsonb_build_object('remaining_org_role',CASE WHEN v_role='admin' THEN v_role ELSE NULL END);
END; $$;

REVOKE EXECUTE ON FUNCTION public.create_facility_invitation(uuid,text,text),public.issue_facility_invitation_token(uuid),public.accept_facility_invitation(text,text,text),public.accept_pending_facility_invitations(),public.revoke_facility_invitation(uuid),public.set_facility_member_role(uuid,text),public.remove_facility_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_facility_invitation(uuid,text,text),public.issue_facility_invitation_token(uuid),public.accept_facility_invitation(text,text,text),public.accept_pending_facility_invitations(),public.revoke_facility_invitation(uuid),public.set_facility_member_role(uuid,text),public.remove_facility_member(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.lookup_facility_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_facility_invitation(text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';