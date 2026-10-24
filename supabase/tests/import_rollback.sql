-- Rollback-only checks for import provenance, rollback_import_batch and the import write RPCs.
-- Every fixture is created inside this block, which always ends by raising, so nothing persists.
DO $$
DECLARE
  u_sup uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  u_viewer uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_fac uuid := gen_random_uuid();
  v_type uuid := gen_random_uuid();
  v_def1 uuid := gen_random_uuid();
  v_def2 uuid := gen_random_uuid();
  a_pre uuid := gen_random_uuid();
  a_pre2 uuid := gen_random_uuid();
  a_pre3 uuid := gen_random_uuid();
  a_pre4 uuid := gen_random_uuid();
  a_new uuid := gen_random_uuid();
  a_new2 uuid := gen_random_uuid();
  a_a uuid := gen_random_uuid();
  a_d uuid := gen_random_uuid();
  a_unrel uuid := gen_random_uuid();
  d_new uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  b3 uuid := gen_random_uuid();
  b4 uuid := gen_random_uuid();
  b5 uuid := gen_random_uuid();
  b6 uuid := gen_random_uuid();
  b7 uuid := gen_random_uuid();
  b8 uuid := gen_random_uuid();
  b9 uuid := gen_random_uuid();
  v_res jsonb;
  v_code text;
  v_xid text;
  v_log text := '';
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_sup, 'r-sup@rollback.test', 'authenticated', 'authenticated'),
    (u_other, 'r-other@rollback.test', 'authenticated', 'authenticated'),
    (u_viewer, 'r-viewer@rollback.test', 'authenticated', 'authenticated');
  INSERT INTO profiles (id, name, email) VALUES
    (u_sup, 'sup', 'r-sup@rollback.test'), (u_other, 'other', 'r-other@rollback.test'), (u_viewer, 'viewer', 'r-viewer@rollback.test');
  INSERT INTO organizations (id, name) VALUES (v_org, 'Rollback Test Org');
  INSERT INTO facilities (id, organization_id, name) VALUES (v_fac, v_org, 'Rollback Test Facility');
  INSERT INTO organization_members (organization_id, user_id, role) VALUES
    (v_org, u_sup, 'member'), (v_org, u_other, 'member'), (v_org, u_viewer, 'member');
  INSERT INTO facility_members (facility_id, user_id, role) VALUES
    (v_fac, u_sup, 'supervisor'), (v_fac, u_other, 'supervisor'), (v_fac, u_viewer, 'viewer');
  INSERT INTO asset_types (id, name, organization_id) VALUES (v_type, 'RB Test Type', v_org);
  INSERT INTO asset_attribute_definitions (id, asset_type_id, name, display_name) VALUES
    (v_def1, v_type, 'rb_one', 'RB One'), (v_def2, v_type, 'rb_two', 'RB Two');
  INSERT INTO assets (id, facility_id, asset_tag, equipment_name, manufacturer, model, asset_type_id) VALUES
    (a_pre, v_fac, 'RB-PRE', 'Pre-existing', 'Old', 'M0', v_type),
    (a_pre2, v_fac, 'RB-PRE2', 'Pre two', 'F1', 'M1', v_type),
    (a_pre3, v_fac, 'RB-PRE3', 'Pre three', 'F1', 'M1', v_type),
    (a_pre4, v_fac, 'RB-PRE4', 'Pre four', 'F1', 'M1', v_type);
  INSERT INTO asset_attribute_values (asset_id, attribute_definition_id, value_text) VALUES (a_pre, v_def1, 'v1');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  INSERT INTO asset_import_batches (id, source_filename, source_fingerprint, status, started_by, facility_id) VALUES
    (b1, 'rb1.xlsx', 'rb1', 'in_progress', u_sup, v_fac), (b2, 'rb2.xlsx', 'rb2', 'in_progress', u_sup, v_fac),
    (b3, 'rb3.xlsx', 'rb3', 'in_progress', u_sup, v_fac), (b4, 'rb4.xlsx', 'rb4', 'in_progress', u_sup, v_fac),
    (b5, 'rb5.xlsx', 'rb5', 'in_progress', u_sup, v_fac), (b6, 'rb6.xlsx', 'rb6', 'in_progress', u_sup, v_fac),
    (b7, 'rb7.xlsx', 'rb7', 'in_progress', u_sup, v_fac), (b8, 'rb8.xlsx', 'rb8', 'in_progress', u_sup, v_fac),
    (b9, 'rb9.xlsx', 'rb9', 'in_progress', u_sup, v_fac);

  -- 0. Field allowlist on import updates
  v_code := NULL;
  BEGIN PERFORM import_update_asset(b1, a_pre, '{"notes":"x"}'::jsonb); EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'FAIL 0 allowlist %', v_code; END IF;
  v_log := v_log || ' 0:allowlist';

  -- 1/2. Golden path: tracked update of an existing asset + tagged new asset, value, profile, document, link
  PERFORM import_update_asset(b1, a_pre, '{"manufacturer":"New"}'::jsonb);
  PERFORM import_upsert_attribute_values(b1, a_pre, jsonb_build_array(
    jsonb_build_object('attribute_definition_id', v_def1, 'value_text', 'v2'),
    jsonb_build_object('attribute_definition_id', v_def2, 'value_text', 'added')));
  INSERT INTO assets (id, facility_id, asset_tag, equipment_name, asset_type_id, import_batch_id)
    VALUES (a_new, v_fac, 'RB-NEW', 'New one', v_type, b1);
  INSERT INTO asset_design_profiles (asset_id, name, sort_order, import_batch_id) VALUES (a_new, 'Cooling Performance', 1, b1);
  PERFORM import_upsert_attribute_values(b1, a_new, jsonb_build_array(jsonb_build_object('attribute_definition_id', v_def1, 'value_text', 'n1')));
  PERFORM import_upsert_attribute_values(b1, a_new, jsonb_build_array(jsonb_build_object('attribute_definition_id', v_def1, 'value_text', 'n2')));
  INSERT INTO documents (id, facility_id, name, import_batch_id) VALUES (d_new, v_fac, 'RB doc', b1);
  INSERT INTO document_asset_links (document_id, asset_id, relationship_type, import_batch_id) VALUES (d_new, a_new, 'reference', b1);
  INSERT INTO asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, entity_type, result, asset_id) VALUES
    (b1, 1, 's', 'new one', 'asset', 'created', a_new),
    (b1, 2, 's', 'pre-existing', 'asset', 'updated', a_pre);
  IF (SELECT count(*) FROM asset_import_entities WHERE batch_id = b1) <> 6
     OR EXISTS (SELECT 1 FROM asset_import_entities WHERE batch_id = b1 AND user_modified) THEN
    RAISE EXCEPTION 'FAIL 2pre provenance %', (SELECT jsonb_agg(to_jsonb(e)) FROM asset_import_entities e WHERE batch_id = b1);
  END IF;
  UPDATE asset_import_batches SET status = 'completed', completed_at = now() WHERE id = b1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'role', 'authenticated')::text, true);
  v_code := NULL;
  BEGIN PERFORM rollback_import_batch(b1); EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FAIL 1 viewer rollback %', v_code; END IF;
  v_log := v_log || ' 1:viewer-denied';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  v_res := rollback_import_batch(b1);
  IF v_res->>'status' <> 'completed' THEN RAISE EXCEPTION 'FAIL 2 %', v_res; END IF;
  IF (SELECT manufacturer FROM assets WHERE id = a_pre) IS DISTINCT FROM 'Old' THEN RAISE EXCEPTION 'FAIL 2a'; END IF;
  IF (SELECT value_text FROM asset_attribute_values WHERE asset_id = a_pre AND attribute_definition_id = v_def1) IS DISTINCT FROM 'v1' THEN RAISE EXCEPTION 'FAIL 2b'; END IF;
  IF EXISTS (SELECT 1 FROM asset_attribute_values WHERE asset_id = a_pre AND attribute_definition_id = v_def2) THEN RAISE EXCEPTION 'FAIL 2c'; END IF;
  IF EXISTS (SELECT 1 FROM assets WHERE id = a_new) OR EXISTS (SELECT 1 FROM documents WHERE id = d_new) THEN RAISE EXCEPTION 'FAIL 2d'; END IF;
  IF (v_res->>'preexistingAssetsKept')::int <> 1 OR (v_res->>'documentLinksDeleted')::int <> 1 THEN RAISE EXCEPTION 'FAIL 2e %', v_res; END IF;
  v_log := v_log || ' 2:golden-path';

  v_res := rollback_import_batch(b1);
  IF v_res->>'status' <> 'already_rolled_back' THEN RAISE EXCEPTION 'FAIL 3 %', v_res; END IF;
  v_log := v_log || ' 3:idempotent';

  -- 4. (A) Later edit -> blocked -> retry stays blocked (no time cutoff that a blocked attempt can advance)
  INSERT INTO assets (id, facility_id, asset_tag, equipment_name, import_batch_id) VALUES (a_a, v_fac, 'RB-A', 'Imported A', b2);
  INSERT INTO asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, entity_type, result, asset_id)
    VALUES (b2, 1, 's', 'imported a', 'asset', 'created', a_a);
  UPDATE asset_import_batches SET status = 'completed', completed_at = now() WHERE id = b2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  UPDATE assets SET equipment_name = 'Edited later' WHERE id = a_a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  v_res := rollback_import_batch(b2);
  IF v_res->>'status' <> 'blocked' THEN RAISE EXCEPTION 'FAIL 4a %', v_res; END IF;
  v_res := rollback_import_batch(b2);
  IF v_res->>'status' <> 'blocked' THEN RAISE EXCEPTION 'FAIL 4b retry %', v_res; END IF;
  IF (SELECT equipment_name FROM assets WHERE id = a_a) IS DISTINCT FROM 'Edited later' THEN RAISE EXCEPTION 'FAIL 4c'; END IF;
  v_log := v_log || ' 4:A-retry-stays-blocked';

  -- 12. (C) Rollback holds row locks on affected assets before deciding (xmax = this transaction)
  v_xid := (txid_current() % 4294967296)::text;
  IF (SELECT xmax::text FROM assets WHERE id = a_a) IS DISTINCT FROM v_xid THEN
    RAISE EXCEPTION 'FAIL 12 asset not locked by rollback (xmax %, xid %)', (SELECT xmax::text FROM assets WHERE id = a_a), v_xid;
  END IF;
  v_log := v_log || ' 12:C-row-locks-held';

  -- 5. Legacy update without snapshot fails closed
  INSERT INTO asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, entity_type, result, asset_id)
    VALUES (b3, 1, 's', 'pre-existing', 'asset', 'updated', a_pre);
  UPDATE asset_import_batches SET status = 'completed' WHERE id = b3;
  v_res := rollback_import_batch(b3);
  IF v_res->>'status' <> 'blocked' OR v_res::text NOT LIKE '%before change tracking existed%' THEN RAISE EXCEPTION 'FAIL 5 %', v_res; END IF;
  v_log := v_log || ' 5:legacy-blocked';

  -- 6. (B) Disjoint sparse patches restore every field
  PERFORM import_update_asset(b4, a_pre2, '{"model":"M2"}'::jsonb);
  PERFORM import_update_asset(b4, a_pre2, '{"manufacturer":"F2"}'::jsonb);
  UPDATE asset_import_batches SET status = 'completed' WHERE id = b4;
  v_res := rollback_import_batch(b4);
  IF v_res->>'status' <> 'completed' OR (SELECT row(model, manufacturer)::text FROM assets WHERE id = a_pre2) <> '(M1,F1)' THEN
    RAISE EXCEPTION 'FAIL 6 % %', v_res, (SELECT row(model, manufacturer)::text FROM assets WHERE id = a_pre2);
  END IF;
  v_log := v_log || ' 6:B-disjoint-restored';

  -- 7. (B) Later edit to the earlier-patched field blocks
  PERFORM import_update_asset(b5, a_pre4, '{"model":"M2"}'::jsonb);
  PERFORM import_update_asset(b5, a_pre4, '{"manufacturer":"F2"}'::jsonb);
  UPDATE asset_import_batches SET status = 'completed' WHERE id = b5;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  UPDATE assets SET model = 'Manual' WHERE id = a_pre4;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  v_res := rollback_import_batch(b5);
  IF v_res->>'status' <> 'blocked' OR (SELECT row(model, manufacturer)::text FROM assets WHERE id = a_pre4) <> '(Manual,F2)' THEN
    RAISE EXCEPTION 'FAIL 7 %', v_res;
  END IF;
  IF (SELECT xmax::text FROM assets WHERE id = a_pre4) IS DISTINCT FROM v_xid THEN RAISE EXCEPTION 'FAIL 7b pre-existing asset not locked'; END IF;
  v_log := v_log || ' 7:B-earlier-key-edit-blocked';

  -- 8. (B) Repeated changes to the same field restore the original
  PERFORM import_update_asset(b6, a_pre3, '{"model":"M2"}'::jsonb);
  PERFORM import_update_asset(b6, a_pre3, '{"model":"M3","manufacturer":"F3"}'::jsonb);
  UPDATE asset_import_batches SET status = 'completed' WHERE id = b6;
  v_res := rollback_import_batch(b6);
  IF v_res->>'status' <> 'completed' OR (SELECT row(model, manufacturer)::text FROM assets WHERE id = a_pre3) <> '(M1,F1)' THEN
    RAISE EXCEPTION 'FAIL 8 %', v_res;
  END IF;
  v_log := v_log || ' 8:B-repeat-restored';

  -- 9. (D) User edit DURING the import blocks, even when the importer writes again afterwards
  INSERT INTO assets (id, facility_id, asset_tag, equipment_name, import_batch_id) VALUES (a_d, v_fac, 'RB-D', 'During', b7);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  UPDATE assets SET notes = 'field note while importing' WHERE id = a_d;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  PERFORM import_update_asset(b7, a_d, '{"model":"X1"}'::jsonb);
  UPDATE asset_import_batches SET status = 'completed' WHERE id = b7;
  v_res := rollback_import_batch(b7);
  IF v_res->>'status' <> 'blocked' OR v_res::text NOT LIKE '%changed by someone else%' OR NOT EXISTS (SELECT 1 FROM assets WHERE id = a_d) THEN
    RAISE EXCEPTION 'FAIL 9 %', v_res;
  END IF;
  v_log := v_log || ' 9:D-during-import-edit-blocked';

  -- 10. (D) Forged provenance is rejected; unproven ownership claims fail closed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  INSERT INTO assets (id, facility_id, asset_tag, equipment_name) VALUES (a_unrel, v_fac, 'RB-UNREL', 'Unrelated');
  v_code := NULL;
  BEGIN INSERT INTO assets (facility_id, asset_tag, equipment_name, import_batch_id) VALUES (v_fac, 'RB-X', 'x', b8);
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FAIL 10a non-owner tagged insert %', v_code; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  v_code := NULL;
  BEGIN UPDATE assets SET import_batch_id = b8 WHERE id = a_unrel; EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FAIL 10b re-tag %', v_code; END IF;
  IF has_table_privilege('authenticated', 'public.asset_import_entities', 'INSERT')
     OR has_table_privilege('authenticated', 'public.asset_import_entities', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL 10c provenance table writable by clients';
  END IF;
  INSERT INTO asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, entity_type, result, asset_id)
    VALUES (b8, 1, 's', 'unrelated', 'asset', 'created', a_unrel);
  UPDATE asset_import_batches SET status = 'completed' WHERE id = b8;
  v_res := rollback_import_batch(b8);
  IF v_res->>'status' <> 'blocked' OR v_res::text NOT LIKE '%cannot be confirmed%' OR NOT EXISTS (SELECT 1 FROM assets WHERE id = a_unrel) THEN
    RAISE EXCEPTION 'FAIL 10d %', v_res;
  END IF;
  v_log := v_log || ' 10:D-forged-provenance-rejected';

  -- 11. (C) No importer writes after rollback; status transitions are guarded
  v_code := NULL;
  BEGIN INSERT INTO assets (facility_id, asset_tag, equipment_name, import_batch_id) VALUES (v_fac, 'RB-Y', 'y', b1);
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '55000' THEN RAISE EXCEPTION 'FAIL 11a tagged insert after rollback %', v_code; END IF;
  v_code := NULL;
  BEGIN PERFORM import_update_asset(b1, a_pre, '{"model":"late"}'::jsonb); EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '55000' THEN RAISE EXCEPTION 'FAIL 11b rpc after rollback %', v_code; END IF;
  v_code := NULL;
  BEGIN UPDATE asset_import_batches SET status = 'in_progress' WHERE id = b1; EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '55000' THEN RAISE EXCEPTION 'FAIL 11c reopen rolled back %', v_code; END IF;
  v_code := NULL;
  BEGIN INSERT INTO asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, entity_type, result)
    VALUES (b1, 9, 's', 'late', 'asset', 'created'); EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '55000' THEN RAISE EXCEPTION 'FAIL 11d record after rollback %', v_code; END IF;
  v_code := NULL;
  BEGIN UPDATE asset_import_batches SET status = 'rolled_back' WHERE id = b9; EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FAIL 11e direct rolled_back %', v_code; END IF;
  v_code := NULL;
  BEGIN UPDATE asset_import_batches SET status = 'in_progress' WHERE id = b8; EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '55000' THEN RAISE EXCEPTION 'FAIL 11f reopen completed %', v_code; END IF;
  v_code := NULL;
  BEGIN PERFORM import_update_asset(b8, a_pre, '{"model":"late"}'::jsonb); EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '55000' THEN RAISE EXCEPTION 'FAIL 11g rpc on completed %', v_code; END IF;
  v_log := v_log || ' 11:C-post-rollback-writes-rejected';

  -- 13. (B) Pre-existing asset with later work on new child rows is kept; grants unchanged
  INSERT INTO assets (id, facility_id, asset_tag, equipment_name, import_batch_id) VALUES (a_new2, v_fac, 'RB-NEW2', 'New two', b9);
  INSERT INTO asset_notes (asset_id, user_id, content) VALUES (a_new2, u_sup, 'field note');
  UPDATE asset_import_batches SET status = 'completed' WHERE id = b9;
  v_res := rollback_import_batch(b9);
  IF v_res->>'status' <> 'blocked' OR NOT EXISTS (SELECT 1 FROM assets WHERE id = a_new2) THEN RAISE EXCEPTION 'FAIL 13 %', v_res; END IF;
  IF has_function_privilege('authenticated', 'public._import_assert_batch_writer(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rollback_import_batch(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 13b execute grants';
  END IF;
  v_log := v_log || ' 13:later-work-blocked+grants';

  RAISE EXCEPTION 'ROLLBACK_ONLY_TEST_OK %', v_log;
END $$;
