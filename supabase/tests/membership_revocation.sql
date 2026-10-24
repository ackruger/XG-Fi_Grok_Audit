-- Rollback-only test: every fixture is discarded by the final RAISE.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_fac uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_sup uuid := gen_random_uuid();
  u_viewer uuid := gen_random_uuid();
  u_target uuid := gen_random_uuid();
  u_orgadmin uuid := gen_random_uuid();
  v_member uuid;
  v_res jsonb;
  v_n integer;
  v_role text;
  v_failed boolean;
  v_log text := '';
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES (u_admin,'t-admin'),(u_sup,'t-sup'),(u_viewer,'t-viewer'),(u_target,'t-target'),(u_orgadmin,'t-orgadmin')) AS x(id, n) LOOP
    INSERT INTO auth.users (id, email, aud, role) VALUES (r.id, r.n || '@rollback.test', 'authenticated', 'authenticated');
    INSERT INTO profiles (id, name, email) VALUES (r.id, r.n, r.n || '@rollback.test');
  END LOOP;
  INSERT INTO organizations (id, name) VALUES (v_org, 'Rollback Test Org');
  INSERT INTO facilities (id, organization_id, name) VALUES (v_fac, v_org, 'Rollback Test Facility');
  INSERT INTO organization_members (organization_id, user_id, role) VALUES
    (v_org, u_admin, 'member'), (v_org, u_sup, 'member'), (v_org, u_viewer, 'member'), (v_org, u_orgadmin, 'admin');
  INSERT INTO facility_members (facility_id, user_id, role) VALUES
    (v_fac, u_admin, 'admin'), (v_fac, u_sup, 'supervisor'), (v_fac, u_viewer, 'viewer'), (v_fac, u_orgadmin, 'contributor');

  -- 1. pending acceptance creates membership
  INSERT INTO facility_invitations (facility_id, email, role, invited_by) VALUES (v_fac, 't-target@rollback.test', 'contributor', u_admin);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_target, 'email', 't-target@rollback.test', 'role', 'authenticated')::text, true);
  v_n := accept_pending_facility_invitations();
  SELECT role INTO v_role FROM facility_members WHERE facility_id = v_fac AND user_id = u_target;
  IF v_n <> 1 OR v_role IS DISTINCT FROM 'contributor' THEN RAISE EXCEPTION 'FAIL 1 pending acceptance n=% role=%', v_n, v_role; END IF;
  v_log := v_log || 'pass:pending_acceptance ';

  -- 2. role retention: existing higher role is not downgraded by a lower pending invite
  UPDATE facility_members SET role = 'supervisor' WHERE facility_id = v_fac AND user_id = u_target;
  INSERT INTO facility_invitations (facility_id, email, role, invited_by) VALUES (v_fac, 't-target@rollback.test', 'viewer', u_admin);
  v_n := accept_pending_facility_invitations();
  SELECT role INTO v_role FROM facility_members WHERE facility_id = v_fac AND user_id = u_target;
  IF v_n <> 1 OR v_role <> 'supervisor' THEN RAISE EXCEPTION 'FAIL 2 role retention n=% role=%', v_n, v_role; END IF;
  v_log := v_log || 'pass:role_retention ';

  SELECT id INTO v_member FROM facility_members WHERE facility_id = v_fac AND user_id = u_target;

  -- 3a. viewer cannot remove
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'email', 't-viewer@rollback.test', 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM remove_facility_member(v_member); EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL 3a viewer removal allowed'; END IF;

  -- 3b. supervisor cannot remove an admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'email', 't-sup@rollback.test', 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM remove_facility_member((SELECT id FROM facility_members WHERE facility_id = v_fac AND user_id = u_admin)); EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL 3b supervisor removed admin'; END IF;

  -- 3c. no session cannot remove
  PERFORM set_config('request.jwt.claims', '', true);
  v_failed := false;
  BEGIN PERFORM remove_facility_member(v_member); EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL 3c anonymous removal allowed'; END IF;

  -- 3d. self removal rejected
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_admin, 'email', 't-admin@rollback.test', 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM remove_facility_member((SELECT id FROM facility_members WHERE facility_id = v_fac AND user_id = u_admin)); EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL 3d self removal allowed'; END IF;
  IF (SELECT count(*) FROM facility_members WHERE facility_id = v_fac) <> 5 THEN RAISE EXCEPTION 'FAIL 3 rejected removals changed membership'; END IF;
  v_log := v_log || 'pass:unauthorized_rejected ';

  -- 4. admin removes target; accepted invites are revoked and cannot restore access
  v_res := remove_facility_member(v_member);
  IF (v_res->>'revoked_invitations')::int <> 2 OR v_res->>'remaining_org_role' IS NOT NULL THEN RAISE EXCEPTION 'FAIL 4 removal result %', v_res; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_target, 'email', 't-target@rollback.test', 'role', 'authenticated')::text, true);
  v_n := accept_pending_facility_invitations();
  IF v_n <> 0 OR EXISTS (SELECT 1 FROM facility_members WHERE facility_id = v_fac AND user_id = u_target)
     OR get_facility_role(v_fac, u_target) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 4 access restored after removal n=%', v_n;
  END IF;
  -- even an invitation manually left 'accepted' must not restore access
  INSERT INTO facility_invitations (facility_id, email, role, invited_by, status, accepted_at) VALUES (v_fac, 't-target@rollback.test', 'admin', u_admin, 'accepted', now());
  v_n := accept_pending_facility_invitations();
  IF v_n <> 0 OR get_facility_role(v_fac, u_target) IS NOT NULL THEN RAISE EXCEPTION 'FAIL 4b accepted invite restored access'; END IF;
  v_log := v_log || 'pass:no_restore_after_removal ';

  -- 5. org admin implicit access is preserved and reported
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_admin, 'email', 't-admin@rollback.test', 'role', 'authenticated')::text, true);
  v_res := remove_facility_member((SELECT id FROM facility_members WHERE facility_id = v_fac AND user_id = u_orgadmin));
  IF v_res->>'remaining_org_role' IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FAIL 5 org admin access %', v_res; END IF;
  v_log := v_log || 'pass:org_admin_preserved ';

  -- 6. revoke pending invitation: supervisor cannot revoke admin invite, admin can revoke
  INSERT INTO facility_invitations (facility_id, email, role, invited_by) VALUES (v_fac, 'x@rollback.test', 'admin', u_admin) RETURNING id INTO v_member;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'email', 't-sup@rollback.test', 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM revoke_facility_invitation(v_member); EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL 6 supervisor revoked admin invite'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_admin, 'email', 't-admin@rollback.test', 'role', 'authenticated')::text, true);
  v_failed := NOT revoke_facility_invitation(v_member);
  IF v_failed OR (SELECT status FROM facility_invitations WHERE id = v_member) <> 'revoked' THEN RAISE EXCEPTION 'FAIL 6 admin revoke'; END IF;
  IF revoke_facility_invitation(v_member) THEN RAISE EXCEPTION 'FAIL 6 re-revoke of non-pending returned true'; END IF;
  v_log := v_log || 'pass:revoke_invitation ';

  RAISE EXCEPTION 'ROLLBACK_ONLY_TEST_OK %', v_log;
END $$;
