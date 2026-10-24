/*
# Import change tracking and safe, server-side rollback

## Summary
Import "undo" used to run as a series of separate browser deletes. It never saved the previous
values of assets it updated, could not tell whether anyone had worked on imported data since,
and always marked the batch as rolled back even if steps failed. This migration moves undo to a
single all-or-nothing database procedure, adds durable before/after snapshots for every change
an import makes to existing data, and records every undo attempt.

## 1. New tables
- `asset_import_changes`: one row per change an import made to pre-existing data.
  - `batch_id`, `facility_id`, `seq` (ordering), `entity_type` (`asset` | `attribute_value`),
    `entity_id`, `asset_id`, `change_type` (`update` | `insert`), `before_data`, `after_data`,
    `created_by`, `created_at`.
- `asset_import_rollback_attempts`: audit of every rollback attempt.
  - `batch_id`, `facility_id`, `attempted_by`, `outcome` (`completed` | `blocked` | `failed`),
    `details` (jsonb), `created_at`.

## 2. Triggers
- `set_row_updated_at()` keeps `updated_at` current on `assets`, `asset_attribute_values`,
  `documents` and `asset_design_profiles`, so later edits to imported data can be detected.

## 3. Functions (SECURITY DEFINER, fixed search_path)
- `import_update_asset(batch, asset, changes)`: applies an allowlisted field update to an existing
  asset and stores the before/after snapshot in the same transaction.
- `import_upsert_attribute_values(batch, asset, values)`: updates or inserts base attribute values
  on an existing asset, snapshotting each change.
  - Both require: signed-in caller who started the batch, batch still in progress, caller is
    supervisor/admin of the batch facility, asset in that facility and not archived.
- `rollback_import_batch(batch)`: supervisor/admin of the batch facility only. Locks the batch,
  blocks (without changing anything) when:
  - the import is still running,
  - existing assets were updated without a saved snapshot (older imports),
  - restored values were edited since the import,
  - imported assets or documents have later work (notes, events, photos, issues, cases, tags,
    status history, service parts, attachments, activity, links, other imports, edits).
  Otherwise restores only this batch's changes, deletes only records the batch created, never
  deletes assets that existed before the batch, and marks the batch rolled back. Unexpected errors
  undo the whole attempt and are recorded as `failed`.
- Internal helpers `_import_assert_batch_writer` and `_import_apply_asset_fields` are not callable
  by clients.

## 4. Security
- RLS enabled on both new tables; facility members may read; no client write policies and
  INSERT/UPDATE/DELETE revoked, so snapshots and audit rows cannot be forged or altered.
- EXECUTE revoked from PUBLIC and anon; only `authenticated` may call the three public functions.

## 5. Notes
1. Additive and idempotent. No existing rows are modified.
2. Edits made before this migration did not update `updated_at`; detection for older batches relies
   on related-record checks and is less complete (disclosed in the app).
*/

CREATE TABLE IF NOT EXISTS public.asset_import_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  batch_id uuid NOT NULL REFERENCES public.asset_import_batches(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('asset', 'attribute_value')),
  entity_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('update', 'insert')),
  before_data jsonb,
  after_data jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_import_changes_batch_seq ON public.asset_import_changes (batch_id, seq);
CREATE INDEX IF NOT EXISTS idx_asset_import_changes_entity ON public.asset_import_changes (entity_id);
CREATE INDEX IF NOT EXISTS idx_asset_import_changes_asset ON public.asset_import_changes (asset_id);

CREATE TABLE IF NOT EXISTS public.asset_import_rollback_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.asset_import_batches(id) ON DELETE SET NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  attempted_by uuid NOT NULL REFERENCES auth.users(id),
  outcome text NOT NULL CHECK (outcome IN ('completed', 'blocked', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_rollback_attempts_batch ON public.asset_import_rollback_attempts (batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_records_asset ON public.asset_import_records (asset_id);
CREATE INDEX IF NOT EXISTS idx_import_records_document ON public.asset_import_records (document_id);

ALTER TABLE public.asset_import_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_import_rollback_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_import_changes FROM anon, authenticated;
REVOKE ALL ON public.asset_import_rollback_attempts FROM anon, authenticated;
GRANT SELECT ON public.asset_import_changes TO authenticated;
GRANT SELECT ON public.asset_import_rollback_attempts TO authenticated;

DROP POLICY IF EXISTS "import_changes_select_members" ON public.asset_import_changes;
CREATE POLICY "import_changes_select_members" ON public.asset_import_changes FOR SELECT
  TO authenticated USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "import_rollback_attempts_select_members" ON public.asset_import_rollback_attempts;
CREATE POLICY "import_rollback_attempts_select_members" ON public.asset_import_rollback_attempts FOR SELECT
  TO authenticated USING (is_facility_member(facility_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assets_set_updated_at ON public.assets;
CREATE TRIGGER trg_assets_set_updated_at BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
DROP TRIGGER IF EXISTS trg_attr_values_set_updated_at ON public.asset_attribute_values;
CREATE TRIGGER trg_attr_values_set_updated_at BEFORE UPDATE ON public.asset_attribute_values
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
DROP TRIGGER IF EXISTS trg_documents_set_updated_at ON public.documents;
CREATE TRIGGER trg_documents_set_updated_at BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
DROP TRIGGER IF EXISTS trg_design_profiles_set_updated_at ON public.asset_design_profiles;
CREATE TRIGGER trg_design_profiles_set_updated_at BEFORE UPDATE ON public.asset_design_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

CREATE OR REPLACE FUNCTION public._import_assert_batch_writer(p_batch_id uuid)
RETURNS public.asset_import_batches
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.asset_import_batches%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.asset_import_batches WHERE id = p_batch_id;
  IF NOT FOUND OR b.started_by <> v_uid
     OR coalesce(public.get_facility_role(b.facility_id, v_uid), '') NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'You do not have permission to write to this import' USING ERRCODE = '42501';
  END IF;
  IF b.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This import is no longer in progress' USING ERRCODE = '55000';
  END IF;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION public._import_apply_asset_fields(p_asset_id uuid, p_fields jsonb)
RETURNS public.assets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.assets%ROWTYPE;
BEGIN
  UPDATE public.assets SET
    source_section    = CASE WHEN p_fields ? 'source_section'    THEN p_fields->>'source_section'           ELSE source_section END,
    source_row        = CASE WHEN p_fields ? 'source_row'        THEN (p_fields->>'source_row')::integer    ELSE source_row END,
    equipment_name    = CASE WHEN p_fields ? 'equipment_name'    THEN p_fields->>'equipment_name'           ELSE equipment_name END,
    asset_type_id     = CASE WHEN p_fields ? 'asset_type_id'     THEN (p_fields->>'asset_type_id')::uuid    ELSE asset_type_id END,
    equipment_type    = CASE WHEN p_fields ? 'equipment_type'    THEN p_fields->>'equipment_type'           ELSE equipment_type END,
    area_served       = CASE WHEN p_fields ? 'area_served'       THEN p_fields->>'area_served'              ELSE area_served END,
    design_stage      = CASE WHEN p_fields ? 'design_stage'      THEN p_fields->>'design_stage'             ELSE design_stage END,
    manufacturer      = CASE WHEN p_fields ? 'manufacturer'      THEN p_fields->>'manufacturer'             ELSE manufacturer END,
    model             = CASE WHEN p_fields ? 'model'             THEN p_fields->>'model'                    ELSE model END,
    serial_number     = CASE WHEN p_fields ? 'serial_number'     THEN p_fields->>'serial_number'            ELSE serial_number END,
    drawing_reference = CASE WHEN p_fields ? 'drawing_reference' THEN p_fields->>'drawing_reference'        ELSE drawing_reference END,
    spec_section      = CASE WHEN p_fields ? 'spec_section'      THEN p_fields->>'spec_section'             ELSE spec_section END
  WHERE id = p_asset_id
  RETURNING * INTO a;
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION public.import_update_asset(p_batch_id uuid, p_asset_id uuid, p_changes jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.asset_import_batches%ROWTYPE;
  a public.assets%ROWTYPE;
  v_key text;
  v_before jsonb;
  v_after jsonb;
  v_allowed text[] := ARRAY['source_section','source_row','equipment_name','asset_type_id','equipment_type',
    'area_served','design_stage','manufacturer','model','serial_number','drawing_reference','spec_section'];
BEGIN
  b := public._import_assert_batch_writer(p_batch_id);
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'No asset changes supplied' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    IF NOT v_key = ANY (v_allowed) THEN
      RAISE EXCEPTION 'Field % cannot be changed by an import', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND OR a.facility_id <> b.facility_id OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Asset not found in this facility' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_object_agg(t.k, to_jsonb(a) -> t.k) INTO v_before FROM jsonb_object_keys(p_changes) AS t(k);
  a := public._import_apply_asset_fields(p_asset_id, p_changes);
  SELECT jsonb_object_agg(t.k, to_jsonb(a) -> t.k) INTO v_after FROM jsonb_object_keys(p_changes) AS t(k);

  INSERT INTO public.asset_import_changes (batch_id, facility_id, entity_type, entity_id, asset_id, change_type, before_data, after_data, created_by)
  VALUES (b.id, b.facility_id, 'asset', p_asset_id, p_asset_id, 'update', v_before, v_after, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.import_upsert_attribute_values(p_batch_id uuid, p_asset_id uuid, p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.asset_import_batches%ROWTYPE;
  a public.assets%ROWTYPE;
  v_item jsonb;
  v_def uuid;
  v_text text;
  v_num public.asset_attribute_values.value_numeric%TYPE;
  v_row public.asset_attribute_values%ROWTYPE;
  v_before jsonb;
  v_inserted int := 0;
  v_updated int := 0;
BEGIN
  b := public._import_assert_batch_writer(p_batch_id);
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'array' OR jsonb_array_length(p_values) > 500 THEN
    RAISE EXCEPTION 'Attribute values must be an array of at most 500 items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND OR a.facility_id <> b.facility_id OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Asset not found in this facility' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_values) LOOP
    v_def := (v_item ->> 'attribute_definition_id')::uuid;
    v_text := v_item ->> 'value_text';
    v_num := (v_item ->> 'value_numeric')::numeric;

    IF NOT EXISTS (
      SELECT 1 FROM public.asset_attribute_definitions d
      JOIN public.asset_types t ON t.id = d.asset_type_id
      JOIN public.facilities f ON f.organization_id = t.organization_id
      WHERE d.id = v_def AND f.id = b.facility_id
    ) THEN
      RAISE EXCEPTION 'Attribute definition does not belong to this organization' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.asset_attribute_values
    WHERE asset_id = p_asset_id AND attribute_definition_id = v_def AND design_profile_id IS NULL
    FOR UPDATE;

    IF FOUND THEN
      v_before := jsonb_build_object('value_text', v_row.value_text, 'value_numeric', v_row.value_numeric);
      UPDATE public.asset_attribute_values SET value_text = v_text, value_numeric = v_num
      WHERE id = v_row.id RETURNING * INTO v_row;
      INSERT INTO public.asset_import_changes (batch_id, facility_id, entity_type, entity_id, asset_id, change_type, before_data, after_data, created_by)
      VALUES (b.id, b.facility_id, 'attribute_value', v_row.id, p_asset_id, 'update', v_before,
              jsonb_build_object('value_text', v_row.value_text, 'value_numeric', v_row.value_numeric), auth.uid());
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.asset_attribute_values (asset_id, attribute_definition_id, design_profile_id, value_text, value_numeric)
      VALUES (p_asset_id, v_def, NULL, v_text, v_num) RETURNING * INTO v_row;
      INSERT INTO public.asset_import_changes (batch_id, facility_id, entity_type, entity_id, asset_id, change_type, before_data, after_data, created_by)
      VALUES (b.id, b.facility_id, 'attribute_value', v_row.id, p_asset_id, 'insert', NULL,
              jsonb_build_object('value_text', v_row.value_text, 'value_numeric', v_row.value_numeric), auth.uid());
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END $$;

CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.asset_import_batches%ROWTYPE;
  v_cutoff timestamptz;
  v_reasons text[] := '{}';
  v_assets uuid[];
  v_docs uuid[];
  v_preexisting int;
  n int;
  rec record;
  v_links int := 0;
  v_docs_deleted int := 0;
  v_values_restored int := 0;
  v_values_removed int := 0;
  v_values_missing int := 0;
  v_assets_restored int := 0;
  v_assets_missing int := 0;
  v_rels int := 0;
  v_profiles int := 0;
  v_values_deleted int := 0;
  v_assets_deleted int := 0;
  v_orphan_types jsonb;
  v_orphan_defs jsonb;
  v_details jsonb;
  v_err text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO b FROM public.asset_import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR coalesce(public.get_facility_role(b.facility_id, v_uid), '') NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'You do not have permission to roll back this import' USING ERRCODE = '42501';
  END IF;

  IF b.status = 'rolled_back' THEN
    RETURN jsonb_build_object('status', 'already_rolled_back', 'reasons', jsonb_build_array('This import has already been rolled back.'));
  END IF;

  IF b.status IN ('pending', 'in_progress') AND coalesce(b.started_at, b.created_at) > now() - interval '1 hour' THEN
    v_reasons := v_reasons || 'This import is still running. Wait for it to finish before rolling it back.'::text;
  END IF;

  SELECT greatest(
    (SELECT max(created_at) FROM public.asset_import_records WHERE batch_id = b.id),
    (SELECT max(created_at) FROM public.asset_import_changes WHERE batch_id = b.id),
    (SELECT max(created_at) FROM public.documents WHERE import_batch_id = b.id),
    (SELECT max(created_at) FROM public.document_asset_links WHERE import_batch_id = b.id),
    b.created_at
  ) INTO v_cutoff;

  SELECT coalesce(array_agg(DISTINCT a.id), '{}') INTO v_assets
  FROM public.asset_import_records r
  JOIN public.assets a ON a.id = r.asset_id
  WHERE r.batch_id = b.id AND r.entity_type = 'asset' AND r.result IN ('created', 'merged_profile')
    AND a.facility_id = b.facility_id AND a.created_at >= b.created_at;

  SELECT count(DISTINCT r.asset_id) INTO v_preexisting
  FROM public.asset_import_records r
  JOIN public.assets a ON a.id = r.asset_id
  WHERE r.batch_id = b.id AND r.entity_type = 'asset' AND r.result IN ('created', 'merged_profile')
    AND NOT (a.id = ANY (v_assets));

  SELECT coalesce(array_agg(d.id), '{}') INTO v_docs
  FROM public.documents d
  WHERE d.import_batch_id = b.id AND d.facility_id = b.facility_id AND d.created_at >= b.created_at;

  SELECT count(*) INTO n FROM public.asset_import_records r
  WHERE r.batch_id = b.id AND r.entity_type = 'asset' AND r.result = 'updated' AND r.asset_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.asset_import_changes c
                    WHERE c.batch_id = b.id AND c.entity_type = 'asset' AND c.entity_id = r.asset_id);
  IF n > 0 THEN
    v_reasons := v_reasons || format('%s existing asset(s) were updated by this import before change tracking existed. Their previous values were not saved, so an automatic undo could overwrite current data. Review those assets manually instead.', n);
  END IF;

  IF cardinality(v_assets) > 0 THEN
    SELECT count(*) INTO n FROM public.asset_notes WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s note(s) were added to imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.events WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s event(s) were recorded on imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.photos WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s photo(s) were added to imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.issues WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s issue(s) reference imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.cases WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s case(s) reference imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.status_history WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s status change(s) were made on imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_tags WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s tag(s) were applied to imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_service_parts WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s service part(s) were added to imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_documents WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s attachment(s) were added to imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.activity_posts WHERE asset_id = ANY (v_assets);
    IF n > 0 THEN v_reasons := v_reasons || format('%s activity post(s) reference imported assets.', n); END IF;
    SELECT count(*) INTO n FROM public.document_asset_links
      WHERE asset_id = ANY (v_assets) AND import_batch_id IS DISTINCT FROM b.id;
    IF n > 0 THEN v_reasons := v_reasons || format('%s document link(s) were added to imported assets outside this import.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_relationships
      WHERE (source_asset_id = ANY (v_assets) OR target_asset_id = ANY (v_assets))
        AND (NOT (source_asset_id = ANY (v_assets) AND target_asset_id = ANY (v_assets)) OR created_at > v_cutoff);
    IF n > 0 THEN v_reasons := v_reasons || format('%s relationship(s) involving imported assets were added later.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_design_profiles
      WHERE asset_id = ANY (v_assets) AND (created_at > v_cutoff OR updated_at > v_cutoff);
    IF n > 0 THEN v_reasons := v_reasons || format('%s design profile(s) on imported assets were added or edited later.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_attribute_values
      WHERE asset_id = ANY (v_assets) AND (created_at > v_cutoff OR updated_at > v_cutoff);
    IF n > 0 THEN v_reasons := v_reasons || format('%s technical value(s) on imported assets were added or edited later.', n); END IF;
    SELECT count(*) INTO n FROM public.assets WHERE id = ANY (v_assets) AND updated_at > v_cutoff;
    IF n > 0 THEN v_reasons := v_reasons || format('%s imported asset(s) were edited after the import.', n); END IF;
    SELECT count(DISTINCT r.asset_id) INTO n FROM public.asset_import_records r
      WHERE r.asset_id = ANY (v_assets) AND r.batch_id <> b.id;
    IF n > 0 THEN v_reasons := v_reasons || format('%s imported asset(s) were used by a later import.', n); END IF;
  END IF;

  IF cardinality(v_docs) > 0 THEN
    SELECT count(*) INTO n FROM public.document_asset_links
      WHERE document_id = ANY (v_docs) AND import_batch_id IS DISTINCT FROM b.id;
    IF n > 0 THEN v_reasons := v_reasons || format('%s link(s) to imported documents were added outside this import.', n); END IF;
    SELECT count(*) INTO n FROM public.documents WHERE id = ANY (v_docs) AND updated_at > v_cutoff;
    IF n > 0 THEN v_reasons := v_reasons || format('%s imported document(s) were edited after the import.', n); END IF;
    SELECT count(DISTINCT r.document_id) INTO n FROM public.asset_import_records r
      WHERE r.document_id = ANY (v_docs) AND r.batch_id <> b.id;
    IF n > 0 THEN v_reasons := v_reasons || format('%s imported document(s) were used by a later import.', n); END IF;
  END IF;

  FOR rec IN
    SELECT c.entity_id,
           (array_agg(c.change_type ORDER BY c.seq))[1] AS first_type,
           (array_agg(c.after_data ORDER BY c.seq DESC))[1] AS last_after,
           v.id AS current_id,
           jsonb_build_object('value_text', v.value_text, 'value_numeric', v.value_numeric) AS current_data
    FROM public.asset_import_changes c
    LEFT JOIN public.asset_attribute_values v ON v.id = c.entity_id
    WHERE c.batch_id = b.id AND c.entity_type = 'attribute_value' AND NOT (c.asset_id = ANY (v_assets))
    GROUP BY c.entity_id, v.id, v.value_text, v.value_numeric
  LOOP
    IF rec.current_id IS NULL AND rec.first_type = 'update' THEN
      v_reasons := v_reasons || 'A technical value this import changed has since been deleted, so its previous value cannot be restored safely.'::text;
    ELSIF rec.current_id IS NOT NULL AND rec.current_data IS DISTINCT FROM rec.last_after THEN
      v_reasons := v_reasons || 'A technical value this import set on an existing asset was edited afterwards.'::text;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT c.entity_id,
           (array_agg(c.after_data ORDER BY c.seq DESC))[1] AS last_after
    FROM public.asset_import_changes c
    WHERE c.batch_id = b.id AND c.entity_type = 'asset' AND NOT (c.entity_id = ANY (v_assets))
    GROUP BY c.entity_id
  LOOP
    IF EXISTS (SELECT 1 FROM public.assets a WHERE a.id = rec.entity_id AND (
         a.deleted_at IS NOT NULL OR
         EXISTS (SELECT 1 FROM jsonb_each(rec.last_after) e WHERE to_jsonb(a) -> e.key IS DISTINCT FROM e.value))) THEN
      v_reasons := v_reasons || 'An existing asset this import updated was edited or archived afterwards.'::text;
    END IF;
  END LOOP;

  IF cardinality(v_reasons) > 0 THEN
    SELECT array_agg(DISTINCT x) INTO v_reasons FROM unnest(v_reasons) AS x;
    v_details := jsonb_build_object('reasons', to_jsonb(v_reasons));
    INSERT INTO public.asset_import_rollback_attempts (batch_id, facility_id, attempted_by, outcome, details)
    VALUES (b.id, b.facility_id, v_uid, 'blocked', v_details);
    INSERT INTO public.asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, import_decision, result, entity_type, message)
    VALUES (b.id, 0, 'rollback', 'Import rollback', 'review', 'failed', 'record',
            left('Rollback blocked: ' || array_to_string(v_reasons, ' '), 2000));
    RETURN jsonb_build_object('status', 'blocked', 'reasons', to_jsonb(v_reasons));
  END IF;

  BEGIN
    DELETE FROM public.document_asset_links WHERE import_batch_id = b.id;
    GET DIAGNOSTICS v_links = ROW_COUNT;
    DELETE FROM public.document_asset_links WHERE document_id = ANY (v_docs);
    GET DIAGNOSTICS n = ROW_COUNT;
    v_links := v_links + n;
    DELETE FROM public.documents WHERE id = ANY (v_docs);
    GET DIAGNOSTICS v_docs_deleted = ROW_COUNT;

    FOR rec IN
      SELECT c.entity_id,
             (array_agg(c.change_type ORDER BY c.seq))[1] AS first_type,
             (array_agg(c.before_data ORDER BY c.seq))[1] AS first_before
      FROM public.asset_import_changes c
      WHERE c.batch_id = b.id AND c.entity_type = 'attribute_value' AND NOT (c.asset_id = ANY (v_assets))
      GROUP BY c.entity_id
    LOOP
      IF rec.first_type = 'insert' THEN
        DELETE FROM public.asset_attribute_values WHERE id = rec.entity_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n = 0 THEN v_values_missing := v_values_missing + 1; ELSE v_values_removed := v_values_removed + n; END IF;
      ELSE
        UPDATE public.asset_attribute_values
        SET value_text = rec.first_before ->> 'value_text',
            value_numeric = (rec.first_before ->> 'value_numeric')::numeric
        WHERE id = rec.entity_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        v_values_restored := v_values_restored + n;
      END IF;
    END LOOP;

    FOR rec IN
      SELECT c.entity_id, (array_agg(c.before_data ORDER BY c.seq))[1] AS first_before
      FROM public.asset_import_changes c
      WHERE c.batch_id = b.id AND c.entity_type = 'asset' AND NOT (c.entity_id = ANY (v_assets))
      GROUP BY c.entity_id
    LOOP
      IF EXISTS (SELECT 1 FROM public.assets WHERE id = rec.entity_id) THEN
        PERFORM public._import_apply_asset_fields(rec.entity_id, rec.first_before);
        v_assets_restored := v_assets_restored + 1;
      ELSE
        v_assets_missing := v_assets_missing + 1;
      END IF;
    END LOOP;

    DELETE FROM public.asset_relationships
    WHERE source_asset_id = ANY (v_assets) OR target_asset_id = ANY (v_assets);
    GET DIAGNOSTICS v_rels = ROW_COUNT;
    DELETE FROM public.asset_attribute_values WHERE asset_id = ANY (v_assets);
    GET DIAGNOSTICS v_values_deleted = ROW_COUNT;
    DELETE FROM public.asset_design_profiles WHERE asset_id = ANY (v_assets);
    GET DIAGNOSTICS v_profiles = ROW_COUNT;
    DELETE FROM public.assets WHERE id = ANY (v_assets);
    GET DIAGNOSTICS v_assets_deleted = ROW_COUNT;

    UPDATE public.asset_import_batches SET status = 'rolled_back' WHERE id = b.id;

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)), '[]'::jsonb) INTO v_orphan_types
    FROM public.asset_types t
    WHERE t.created_by_import_batch_id = b.id
      AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.asset_type_id = t.id);

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'assetTypeName', coalesce(t.name, 'Unknown'))), '[]'::jsonb)
    INTO v_orphan_defs
    FROM public.asset_attribute_definitions d
    LEFT JOIN public.asset_types t ON t.id = d.asset_type_id
    WHERE d.created_by_import_batch_id = b.id
      AND NOT EXISTS (SELECT 1 FROM public.asset_attribute_values v WHERE v.attribute_definition_id = d.id);

    v_details := jsonb_build_object(
      'status', 'completed',
      'assetsDeleted', v_assets_deleted,
      'profilesDeleted', v_profiles,
      'valuesDeleted', v_values_deleted,
      'relationshipsDeleted', v_rels,
      'documentsDeleted', v_docs_deleted,
      'documentLinksDeleted', v_links,
      'assetsRestored', v_assets_restored,
      'assetsAlreadyRemoved', v_assets_missing,
      'valuesRestored', v_values_restored,
      'valuesRemoved', v_values_removed,
      'valuesAlreadyRemoved', v_values_missing,
      'preexistingAssetsKept', v_preexisting,
      'orphanedTypes', v_orphan_types,
      'orphanedDefinitions', v_orphan_defs
    );

    INSERT INTO public.asset_import_rollback_attempts (batch_id, facility_id, attempted_by, outcome, details)
    VALUES (b.id, b.facility_id, v_uid, 'completed', v_details);
    INSERT INTO public.asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, import_decision, result, entity_type, message)
    VALUES (b.id, 0, 'rollback', 'Import rollback', 'review', 'skipped', 'record',
            format('Rolled back: %s assets deleted, %s assets restored, %s values restored, %s values removed, %s documents deleted, %s links removed.',
                   v_assets_deleted, v_assets_restored, v_values_restored, v_values_removed + v_values_deleted, v_docs_deleted, v_links));
    RETURN v_details;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  INSERT INTO public.asset_import_rollback_attempts (batch_id, facility_id, attempted_by, outcome, details)
  VALUES (b.id, b.facility_id, v_uid, 'failed', jsonb_build_object('error', left(v_err, 1000)));
  INSERT INTO public.asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, import_decision, result, entity_type, message)
  VALUES (b.id, 0, 'rollback', 'Import rollback', 'review', 'failed', 'record',
          left('Rollback failed and nothing was changed: ' || v_err, 2000));
  RETURN jsonb_build_object('status', 'failed', 'reasons', jsonb_build_array('The rollback hit an unexpected error and nothing was changed: ' || left(v_err, 500)));
END $$;

REVOKE EXECUTE ON FUNCTION public.set_row_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._import_assert_batch_writer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._import_apply_asset_fields(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.import_update_asset(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.import_upsert_attribute_values(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rollback_import_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_update_asset(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_upsert_attribute_values(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(uuid) TO authenticated;
