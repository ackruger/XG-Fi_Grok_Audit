-- Rollback-only checks for ai_facility_summary and ai_chat_register_request.
DO $$
DECLARE
  u_member uuid := gen_random_uuid();
  u_outsider uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_fac uuid := gen_random_uuid();
  v_last uuid;
  v_res jsonb;
  v_failed boolean;
  v_log text := '';
  i int;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_member, 'ai-member@rollback.test', 'authenticated', 'authenticated'),
    (u_outsider, 'ai-out@rollback.test', 'authenticated', 'authenticated');
  INSERT INTO profiles (id, name, email) VALUES (u_member, 'm', 'ai-member@rollback.test'), (u_outsider, 'o', 'ai-out@rollback.test');
  INSERT INTO organizations (id, name) VALUES (v_org, 'Rollback Test Org');
  INSERT INTO facilities (id, organization_id, name) VALUES (v_fac, v_org, 'Rollback Test Facility');
  INSERT INTO organization_members (organization_id, user_id, role) VALUES (v_org, u_member, 'member');
  INSERT INTO facility_members (facility_id, user_id, role) VALUES (v_fac, u_member, 'viewer');

  INSERT INTO assets (facility_id, asset_tag, equipment_name, status, equipment_type)
    SELECT v_fac, 'AI-' || g, 'Unit ' || lpad(g::text, 4, '0'), CASE WHEN g % 10 = 0 THEN 'complete' ELSE 'not_started' END, 'AHU'
    FROM generate_series(1, 450) g;
  INSERT INTO assets (facility_id, asset_tag, equipment_name, status, deleted_at) VALUES (v_fac, 'AI-DEL', 'Deleted', 'complete', now());
  SELECT id INTO v_last FROM assets WHERE facility_id = v_fac AND asset_tag = 'AI-450';
  INSERT INTO cases (facility_id, title, status, priority, created_by, asset_id) VALUES
    (v_fac, 'Case on asset outside first 200', 'open', 'high', u_member, v_last),
    (v_fac, 'Case without asset', 'in_progress', 'medium', u_member, NULL);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_outsider, 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM ai_facility_summary(v_fac); EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL 1 outsider read summary'; END IF;
  v_failed := false;
  BEGIN PERFORM ai_chat_register_request(v_fac); EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL 1b outsider registered'; END IF;
  v_log := v_log || ' 1:outsider-blocked';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  v_res := ai_facility_summary(v_fac);
  IF (v_res->>'total_assets')::int <> 450 THEN RAISE EXCEPTION 'FAIL 2 total %', v_res->>'total_assets'; END IF;
  IF (v_res->'assets_by_status'->>'complete')::int <> 45 THEN RAISE EXCEPTION 'FAIL 2b status %', v_res->'assets_by_status'; END IF;
  IF (v_res->>'total_cases')::int <> 2 OR (v_res->>'open_cases')::int <> 2 THEN RAISE EXCEPTION 'FAIL 2c cases %', v_res; END IF;
  v_log := v_log || ' 2:full-totals';

  FOR i IN 1..6 LOOP
    v_res := ai_chat_register_request(v_fac);
    IF NOT (v_res->>'allowed')::boolean THEN RAISE EXCEPTION 'FAIL 3 blocked early at %', i; END IF;
  END LOOP;
  v_res := ai_chat_register_request(v_fac);
  IF (v_res->>'allowed')::boolean OR (v_res->>'retry_after_seconds')::int < 1 THEN RAISE EXCEPTION 'FAIL 3b %', v_res; END IF;
  v_log := v_log || ' 3:rate-limited';

  IF has_table_privilege('authenticated', 'public.ai_chat_requests', 'SELECT')
     OR has_function_privilege('anon', 'public.ai_facility_summary(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 4 grants';
  END IF;
  v_log := v_log || ' 4:grants';

  RAISE EXCEPTION 'ROLLBACK_ONLY_TEST_OK %', v_log;
END $$;
