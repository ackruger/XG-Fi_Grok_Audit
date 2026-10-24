/*
# AI assistant: full-facility totals and request limits

1. Purpose
- The AI assistant previously looked at only the first 200 assets and computed
  every total from that sample, and only saw cases linked to those 200 assets.
- This adds a server-side summary that counts ALL active assets and ALL cases in a
  facility, and a durable per-user request log used to rate-limit the assistant.

2. New Tables
- `ai_chat_requests`
  - `id` (uuid, primary key)
  - `user_id` (uuid, who asked; references auth.users)
  - `facility_id` (uuid, which facility; references facilities)
  - `created_at` (timestamptz)

3. New Functions
- `ai_facility_summary(p_facility_id uuid) returns jsonb`
  SECURITY DEFINER, fixed search_path. Requires the caller to have a facility
  role (direct membership or organization fallback). Returns asset totals by status,
  type and location, plus case totals (cases table) and legacy issue totals.
- `ai_chat_register_request(p_facility_id uuid) returns jsonb`
  SECURITY DEFINER, fixed search_path. Requires a facility role, serializes per user
  with an advisory lock, enforces 6 requests/minute and 60 requests/hour, and records
  the request only when allowed. Returns {allowed, retry_after_seconds}.

4. Security
- RLS enabled on `ai_chat_requests` with no policies; all client privileges revoked.
  Only the functions above write or read it.
- EXECUTE on both functions revoked from PUBLIC/anon and granted to authenticated only.

5. Notes
1. Additive and idempotent; no existing data is changed.
*/

CREATE TABLE IF NOT EXISTS public.ai_chat_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chat_requests_user_created_idx ON public.ai_chat_requests (user_id, created_at DESC);
ALTER TABLE public.ai_chat_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_chat_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_facility_summary(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.get_facility_role(p_facility_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this facility' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'total_assets', (SELECT count(*) FROM assets WHERE facility_id = p_facility_id AND deleted_at IS NULL),
    'assets_by_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status, 'unknown') s, count(*) n FROM assets
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1) x), '{}'::jsonb),
    'distinct_types', (SELECT count(DISTINCT coalesce(equipment_type, '')) FROM assets WHERE facility_id = p_facility_id AND deleted_at IS NULL),
    'assets_by_type', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t, 'count', n) ORDER BY n DESC, t) FROM (
        SELECT coalesce(nullif(equipment_type, ''), 'Unspecified') t, count(*) n FROM assets
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30) x), '[]'::jsonb),
    'distinct_locations', (SELECT count(DISTINCT coalesce(l.building, '') || '/' || coalesce(l.floor, ''))
        FROM assets a LEFT JOIN locations l ON l.id = a.location_id WHERE a.facility_id = p_facility_id AND a.deleted_at IS NULL),
    'assets_by_location', coalesce((SELECT jsonb_agg(jsonb_build_object('name', loc, 'count', n, 'incomplete', inc) ORDER BY n DESC, loc) FROM (
        SELECT coalesce(nullif(concat_ws(' / ', nullif(l.building, ''), nullif(l.floor, '')), ''), 'No location') loc,
               count(*) n,
               count(*) FILTER (WHERE coalesce(a.status, '') NOT IN ('complete', 'accepted', 'closed')) inc
        FROM assets a LEFT JOIN locations l ON l.id = a.location_id
        WHERE a.facility_id = p_facility_id AND a.deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30) x), '[]'::jsonb),
    'total_cases', (SELECT count(*) FROM cases WHERE facility_id = p_facility_id AND deleted_at IS NULL),
    'open_cases', (SELECT count(*) FROM cases WHERE facility_id = p_facility_id AND deleted_at IS NULL
        AND closed_at IS NULL AND coalesce(status::text, '') NOT IN ('closed', 'resolved', 'cancelled')),
    'cases_by_status', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT coalesce(status::text, 'unknown') s, count(*) n FROM cases
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1) x), '{}'::jsonb),
    'cases_by_priority', coalesce((SELECT jsonb_object_agg(p, n) FROM (
        SELECT coalesce(priority::text, 'unspecified') p, count(*) n FROM cases
        WHERE facility_id = p_facility_id AND deleted_at IS NULL GROUP BY 1) x), '{}'::jsonb),
    'total_issues', (SELECT count(*) FROM issues i JOIN assets a ON a.id = i.asset_id
        WHERE a.facility_id = p_facility_id AND i.deleted_at IS NULL),
    'open_issues', (SELECT count(*) FROM issues i JOIN assets a ON a.id = i.asset_id
        WHERE a.facility_id = p_facility_id AND i.deleted_at IS NULL AND coalesce(i.status, '') NOT IN ('closed', 'verified'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_chat_register_request(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_minute int;
  v_hour int;
  v_oldest timestamptz;
BEGIN
  IF v_uid IS NULL OR public.get_facility_role(p_facility_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this facility' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ai_chat:' || v_uid::text, 0));

  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'), count(*)
    INTO v_minute, v_hour
    FROM ai_chat_requests WHERE user_id = v_uid AND created_at > now() - interval '1 hour';

  IF v_minute >= 6 THEN
    SELECT min(created_at) INTO v_oldest FROM ai_chat_requests WHERE user_id = v_uid AND created_at > now() - interval '1 minute';
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', greatest(1, ceil(extract(epoch FROM v_oldest + interval '1 minute' - now()))::int));
  END IF;
  IF v_hour >= 60 THEN
    SELECT min(created_at) INTO v_oldest FROM ai_chat_requests WHERE user_id = v_uid AND created_at > now() - interval '1 hour';
    RETURN jsonb_build_object('allowed', false, 'retry_after_seconds', greatest(1, ceil(extract(epoch FROM v_oldest + interval '1 hour' - now()))::int));
  END IF;

  INSERT INTO ai_chat_requests (user_id, facility_id) VALUES (v_uid, p_facility_id);
  DELETE FROM ai_chat_requests WHERE user_id = v_uid AND created_at < now() - interval '1 day';
  RETURN jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_facility_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_chat_register_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_facility_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_chat_register_request(uuid) TO authenticated;
