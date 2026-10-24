/*
# Add ai_facility_summary RPC for dashboard and AI chat

## Purpose
The dashboard and AI chat edge function call `ai_facility_summary(p_facility_id)` to get
facility-wide asset and case totals. Migration 068 defined this function but was not
applied to this clone (it depends on the `cases` table which does not exist here yet).
This migration provides the same function using only tables that exist in this clone,
returning zero for all case-related totals until the `cases` table is introduced.

## Response shape (jsonb)
- total_assets           int — active (non-deleted) assets in the facility
- assets_by_status       object — count grouped by assets.status
- distinct_types         int — count of distinct equipment_type values
- assets_by_type         array — top 30 {name, count} by equipment_type
- distinct_locations     int — count of distinct building/floor combinations
- assets_by_location     array — top 30 {name, count, incomplete} by location
- total_cases            int — 0 (cases table does not exist in this clone)
- open_cases             int — 0 (cases table does not exist in this clone)
- cases_by_status        object — empty {}
- cases_by_priority      object — empty {}
- total_issues           int — open+closed issues on assets in this facility
- open_issues            int — issues not in closed/verified status

## Security
- SECURITY DEFINER, search_path locked to 'public'
- Verifies the caller has a facility role via get_facility_role(); raises 42501 if not
- EXECUTE revoked from PUBLIC and anon; granted only to authenticated and service_role

## Notes
1. Idempotent — CREATE OR REPLACE FUNCTION.
2. When the cases table is added in a future migration, this function can be replaced
   with one that queries it. Until then, case totals are hard-coded to zero.
3. No RLS policies are changed. No data is seeded or deleted.
*/

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
    -- cases table does not exist in this clone; return zeros until it is introduced
    'total_cases', 0,
    'open_cases', 0,
    'cases_by_status', '{}'::jsonb,
    'cases_by_priority', '{}'::jsonb,
    'total_issues', (SELECT count(*) FROM issues i JOIN assets a ON a.id = i.asset_id
        WHERE a.facility_id = p_facility_id AND i.deleted_at IS NULL),
    'open_issues', (SELECT count(*) FROM issues i JOIN assets a ON a.id = i.asset_id
        WHERE a.facility_id = p_facility_id AND i.deleted_at IS NULL AND coalesce(i.status, '') NOT IN ('closed', 'verified'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_facility_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_facility_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_facility_summary(uuid) TO service_role;