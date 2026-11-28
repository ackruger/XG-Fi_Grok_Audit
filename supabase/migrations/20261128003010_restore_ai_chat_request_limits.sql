/*
# Restore AI chat request limits

## 1. New table
- ai_chat_requests stores an ID, authenticated user, facility, and request timestamp for the existing AI chat limits.
- Index user and timestamp for hourly counting.

## 2. Restored function
- ai_chat_register_request checks facility access and atomically enforces six requests per minute and sixty per hour per user.

## 3. Security
- Enable RLS and deny direct client CRUD through separate policies.
- Only authenticated callers can execute the function; session identity determines the actor.
- Fixed search path and per-user transaction lock protect authorization and concurrent counting.

## 4. Notes
1. No facility or asset data is changed.
2. Existing request history is preserved on reapplication.
*/
CREATE TABLE IF NOT EXISTS public.ai_chat_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_requests_user_time ON public.ai_chat_requests(user_id,created_at DESC);
ALTER TABLE public.ai_chat_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_chat_requests FROM anon,authenticated;
DROP POLICY IF EXISTS "deny_direct_select" ON public.ai_chat_requests;
CREATE POLICY "deny_direct_select" ON public.ai_chat_requests FOR SELECT TO authenticated USING(false);
DROP POLICY IF EXISTS "deny_direct_insert" ON public.ai_chat_requests;
CREATE POLICY "deny_direct_insert" ON public.ai_chat_requests FOR INSERT TO authenticated WITH CHECK(false);
DROP POLICY IF EXISTS "deny_direct_update" ON public.ai_chat_requests;
CREATE POLICY "deny_direct_update" ON public.ai_chat_requests FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
DROP POLICY IF EXISTS "deny_direct_delete" ON public.ai_chat_requests;
CREATE POLICY "deny_direct_delete" ON public.ai_chat_requests FOR DELETE TO authenticated USING(false);
CREATE OR REPLACE FUNCTION public.ai_chat_register_request(p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_uid uuid := auth.uid();
 v_minute int;
 v_hour int;
 v_oldest timestamptz;
BEGIN
 IF v_uid IS NULL OR public.get_facility_role(p_facility_id,v_uid) IS NULL THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai_chat:' || v_uid::text,0));
 SELECT count(*) FILTER(WHERE created_at > now()-interval '1 minute'),count(*) INTO v_minute,v_hour FROM public.ai_chat_requests WHERE user_id=v_uid AND created_at > now()-interval '1 hour';
 IF v_minute >= 6 THEN
  SELECT min(created_at) INTO v_oldest FROM public.ai_chat_requests WHERE user_id=v_uid AND created_at > now()-interval '1 minute';
  RETURN jsonb_build_object('allowed',false,'retry_after_seconds',greatest(1,ceil(extract(epoch FROM v_oldest+interval '1 minute'-now()))::int));
 END IF;
 IF v_hour >= 60 THEN
  SELECT min(created_at) INTO v_oldest FROM public.ai_chat_requests WHERE user_id=v_uid AND created_at > now()-interval '1 hour';
  RETURN jsonb_build_object('allowed',false,'retry_after_seconds',greatest(1,ceil(extract(epoch FROM v_oldest+interval '1 hour'-now()))::int));
 END IF;
 INSERT INTO public.ai_chat_requests(user_id,facility_id) VALUES(v_uid,p_facility_id);
 RETURN jsonb_build_object('allowed',true,'retry_after_seconds',0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_chat_register_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ai_chat_register_request(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';