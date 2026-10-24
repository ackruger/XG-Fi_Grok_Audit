/*
  # 069 Import rollback: trusted provenance, per-field snapshots and ordered locking

  Follow-up to 067. Fixes four flaws in rollback_import_batch and the import write RPCs.

  1. New table `asset_import_entities` (server-written only)
     - One row per entity created by an import (asset, document, attribute value,
       design profile, relationship, document link), written by an AFTER INSERT trigger
       that only fires for rows carrying a validated `import_batch_id`.
     - `user_modified` flips to true on any real UPDATE of that entity not made by the
       owning import's own server RPC, including edits made while the import is running.
     - RLS enabled with no policies; all client privileges revoked.

  2. New nullable `import_batch_id` columns on assets, asset_attribute_values,
     asset_design_profiles and asset_relationships (documents and document_asset_links
     already have one). A BEFORE INSERT trigger validates the tag (caller started the batch,
     is supervisor/admin, batch is in_progress and locked FOR SHARE, facility matches).
     A BEFORE UPDATE trigger forbids re-pointing the tag, so provenance cannot be forged.

  3. Batch guard trigger: rolled_back is terminal, only rollback_import_batch may set it,
     finished batches cannot be reopened, owner/facility/timestamps are immutable, and a
     new batch must be started by the caller. Import records cannot be added to a rolled
     back batch.

  4. `_import_assert_batch_writer` becomes VOLATILE and locks the batch FOR SHARE, so import
     RPCs and tagged inserts serialize against rollback (which locks it FOR UPDATE).

  5. `rollback_import_batch` rewritten:
     - Ownership comes only from asset_import_entities. Client-written import records that
       claim created rows without provenance block the rollback (fail closed).
     - No time cutoff at all; edits are detected per entity (user_modified flag) and per
       field for pre-existing assets, so rollback/audit records can never weaken checks.
     - Sparse patches merged per field: earliest before / latest after per key.
     - Locks batch, then assets, documents, design profiles, attribute values,
       relationships and document links (each ORDER BY id, FOR UPDATE) before any check.

  No data is deleted or rewritten by this migration.
*/

CREATE TABLE IF NOT EXISTS public.asset_import_entities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.asset_import_batches(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('asset','document','attribute_value','design_profile','relationship','document_asset_link')),
  entity_id uuid NOT NULL,
  asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_modified boolean NOT NULL DEFAULT false,
  modified_at timestamptz,
  UNIQUE (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS asset_import_entities_batch_idx ON public.asset_import_entities (batch_id, entity_type);
ALTER TABLE public.asset_import_entities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_import_entities FROM anon, authenticated;

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.asset_import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.asset_attribute_values ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.asset_import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.asset_design_profiles ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.asset_import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.asset_relationships ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.asset_import_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS assets_import_batch_idx ON public.assets (import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._import_entity_type(p_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_table
    WHEN 'assets' THEN 'asset'
    WHEN 'documents' THEN 'document'
    WHEN 'asset_attribute_values' THEN 'attribute_value'
    WHEN 'asset_design_profiles' THEN 'design_profile'
    WHEN 'asset_relationships' THEN 'relationship'
    WHEN 'document_asset_links' THEN 'document_asset_link'
  END
$$;

CREATE OR REPLACE FUNCTION public._import_tag_guard_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.asset_import_batches%ROWTYPE;
  j jsonb := to_jsonb(NEW);
  v_fac uuid;
BEGIN
  IF NEW.import_batch_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO b FROM public.asset_import_batches WHERE id = NEW.import_batch_id FOR SHARE;
  IF NOT FOUND OR v_uid IS NULL OR b.started_by <> v_uid
     OR coalesce(public.get_facility_role(b.facility_id, v_uid), '') NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Only the person running this import can add rows to it' USING ERRCODE = '42501';
  END IF;
  IF b.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This import is no longer in progress' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME IN ('assets', 'documents') THEN
    v_fac := (j->>'facility_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('asset_attribute_values', 'asset_design_profiles') THEN
    SELECT facility_id INTO v_fac FROM public.assets WHERE id = (j->>'asset_id')::uuid;
  ELSIF TG_TABLE_NAME = 'asset_relationships' THEN
    SELECT facility_id INTO v_fac FROM public.assets WHERE id = (j->>'source_asset_id')::uuid;
  ELSIF TG_TABLE_NAME = 'document_asset_links' THEN
    SELECT facility_id INTO v_fac FROM public.documents WHERE id = (j->>'document_id')::uuid;
  END IF;
  IF v_fac IS DISTINCT FROM b.facility_id THEN
    RAISE EXCEPTION 'Imported rows must belong to the import''s facility' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._import_tag_record_entity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
  v_asset uuid;
BEGIN
  IF NEW.import_batch_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_asset := CASE TG_TABLE_NAME
    WHEN 'assets' THEN NEW.id
    WHEN 'asset_relationships' THEN (j->>'source_asset_id')::uuid
    WHEN 'documents' THEN NULL
    ELSE (j->>'asset_id')::uuid
  END;
  INSERT INTO public.asset_import_entities (batch_id, facility_id, entity_type, entity_id, asset_id)
  SELECT NEW.import_batch_id, b.facility_id, public._import_entity_type(TG_TABLE_NAME), NEW.id, v_asset
  FROM public.asset_import_batches b WHERE b.id = NEW.import_batch_id;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._import_tag_guard_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.import_batch_id IS NOT NULL AND NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id THEN
    RAISE EXCEPTION 'Import provenance cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._import_mark_entity_modified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_writer text := nullif(current_setting('xgfi.import_writer', true), '');
BEGIN
  IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NULL;
  END IF;
  UPDATE public.asset_import_entities
  SET user_modified = true, modified_at = now()
  WHERE entity_type = public._import_entity_type(TG_TABLE_NAME)
    AND entity_id = NEW.id
    AND batch_id::text IS DISTINCT FROM v_writer
    AND NOT user_modified;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets','documents','asset_attribute_values','asset_design_profiles','asset_relationships','document_asset_links'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_import_tag_guard_insert ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_import_tag_guard_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public._import_tag_guard_insert()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_import_tag_record_entity ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_import_tag_record_entity AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public._import_tag_record_entity()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_import_tag_guard_update ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_import_tag_guard_update BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._import_tag_guard_update()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_import_mark_entity_modified ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_import_mark_entity_modified AFTER UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._import_mark_entity_modified()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._import_batch_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND NEW.started_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'An import must be started by the signed-in user' USING ERRCODE = '42501';
    END IF;
    IF v_uid IS NOT NULL AND NEW.status NOT IN ('pending', 'in_progress') THEN
      RAISE EXCEPTION 'A new import must start as pending or in progress' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'rolled_back' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'A rolled back import cannot be changed' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'rolled_back' AND OLD.status <> 'rolled_back'
     AND current_setting('xgfi.import_rollback', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'Imports can only be rolled back through the rollback action' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('completed', 'failed') AND NEW.status IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'A finished import cannot be reopened' USING ERRCODE = '55000';
  END IF;
  IF NEW.started_by IS DISTINCT FROM OLD.started_by OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Import ownership and start details cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_import_batch_guard ON public.asset_import_batches;
CREATE TRIGGER trg_import_batch_guard BEFORE INSERT OR UPDATE ON public.asset_import_batches
  FOR EACH ROW EXECUTE FUNCTION public._import_batch_guard();

CREATE OR REPLACE FUNCTION public._import_record_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.asset_import_batches WHERE id = NEW.batch_id AND status = 'rolled_back')
     AND current_setting('xgfi.import_rollback', true) IS DISTINCT FROM NEW.batch_id::text THEN
    RAISE EXCEPTION 'This import has been rolled back' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_import_record_guard ON public.asset_import_records;
CREATE TRIGGER trg_import_record_guard BEFORE INSERT ON public.asset_import_records
  FOR EACH ROW EXECUTE FUNCTION public._import_record_guard();

REVOKE EXECUTE ON FUNCTION public._import_tag_guard_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._import_tag_record_entity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._import_tag_guard_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._import_mark_entity_modified() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._import_batch_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._import_record_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._import_assert_batch_writer(p_batch_id uuid)
RETURNS public.asset_import_batches
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.asset_import_batches%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.asset_import_batches WHERE id = p_batch_id FOR SHARE;
  IF NOT FOUND OR b.started_by <> v_uid
     OR coalesce(public.get_facility_role(b.facility_id, v_uid), '') NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'You do not have permission to write to this import' USING ERRCODE = '42501';
  END IF;
  IF b.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This import is no longer in progress' USING ERRCODE = '55000';
  END IF;
  RETURN b;
END $$;
REVOKE EXECUTE ON FUNCTION public._import_assert_batch_writer(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_update_asset(p_batch_id uuid, p_asset_id uuid, p_changes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  PERFORM set_config('xgfi.import_writer', b.id::text, true);
  SELECT jsonb_object_agg(t.k, to_jsonb(a) -> t.k) INTO v_before FROM jsonb_object_keys(p_changes) AS t(k);
  a := public._import_apply_asset_fields(p_asset_id, p_changes);
  SELECT jsonb_object_agg(t.k, to_jsonb(a) -> t.k) INTO v_after FROM jsonb_object_keys(p_changes) AS t(k);
  PERFORM set_config('xgfi.import_writer', '', true);

  INSERT INTO public.asset_import_changes (batch_id, facility_id, entity_type, entity_id, asset_id, change_type, before_data, after_data, created_by)
  VALUES (b.id, b.facility_id, 'asset', p_asset_id, p_asset_id, 'update', v_before, v_after, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.import_upsert_attribute_values(p_batch_id uuid, p_asset_id uuid, p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  PERFORM set_config('xgfi.import_writer', b.id::text, true);
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
    ORDER BY id LIMIT 1
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
      INSERT INTO public.asset_attribute_values (asset_id, attribute_definition_id, design_profile_id, value_text, value_numeric, import_batch_id)
      VALUES (p_asset_id, v_def, NULL, v_text, v_num, b.id) RETURNING * INTO v_row;
      INSERT INTO public.asset_import_changes (batch_id, facility_id, entity_type, entity_id, asset_id, change_type, before_data, after_data, created_by)
      VALUES (b.id, b.facility_id, 'attribute_value', v_row.id, p_asset_id, 'insert', NULL,
        jsonb_build_object('value_text', v_row.value_text, 'value_numeric', v_row.value_numeric), auth.uid());
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  PERFORM set_config('xgfi.import_writer', '', true);

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END $$;

CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.asset_import_batches%ROWTYPE;
  v_reasons text[] := '{}';
  v_assets uuid[];
  v_docs uuid[];
  v_changed_assets uuid[];
  v_changed_values uuid[];
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

  PERFORM set_config('xgfi.import_rollback', b.id::text, true);
  PERFORM set_config('xgfi.import_writer', b.id::text, true);

  IF b.status IN ('pending', 'in_progress') AND coalesce(b.started_at, b.created_at) > now() - interval '1 hour' THEN
    v_reasons := v_reasons || 'This import is still running. Wait for it to finish before rolling it back.'::text;
  END IF;

  SELECT coalesce(array_agg(e.entity_id ORDER BY e.entity_id), '{}') INTO v_assets
  FROM public.asset_import_entities e WHERE e.batch_id = b.id AND e.entity_type = 'asset';
  SELECT coalesce(array_agg(e.entity_id ORDER BY e.entity_id), '{}') INTO v_docs
  FROM public.asset_import_entities e WHERE e.batch_id = b.id AND e.entity_type = 'document';
  SELECT coalesce(array_agg(DISTINCT c.entity_id), '{}') INTO v_changed_assets
  FROM public.asset_import_changes c
  WHERE c.batch_id = b.id AND c.entity_type = 'asset' AND NOT (c.entity_id = ANY (v_assets));
  SELECT coalesce(array_agg(DISTINCT c.entity_id), '{}') INTO v_changed_values
  FROM public.asset_import_changes c
  WHERE c.batch_id = b.id AND c.entity_type = 'attribute_value' AND NOT (c.asset_id = ANY (v_assets));
  SELECT count(DISTINCT c.asset_id) INTO v_preexisting
  FROM public.asset_import_changes c WHERE c.batch_id = b.id AND NOT (c.asset_id = ANY (v_assets));

  -- Ordered row locks before any check: assets, documents, profiles, values, relationships, links.
  SELECT count(*) INTO n FROM (SELECT id FROM public.assets
    WHERE id = ANY (v_assets) OR id = ANY (v_changed_assets) ORDER BY id FOR UPDATE) s;
  SELECT count(*) INTO n FROM (SELECT id FROM public.documents
    WHERE id = ANY (v_docs) ORDER BY id FOR UPDATE) s;
  SELECT count(*) INTO n FROM (SELECT id FROM public.asset_design_profiles
    WHERE asset_id = ANY (v_assets) ORDER BY id FOR UPDATE) s;
  SELECT count(*) INTO n FROM (SELECT id FROM public.asset_attribute_values
    WHERE asset_id = ANY (v_assets) OR id = ANY (v_changed_values) ORDER BY id FOR UPDATE) s;
  SELECT count(*) INTO n FROM (SELECT id FROM public.asset_relationships
    WHERE source_asset_id = ANY (v_assets) OR target_asset_id = ANY (v_assets) ORDER BY id FOR UPDATE) s;
  SELECT count(*) INTO n FROM (SELECT id FROM public.document_asset_links
    WHERE document_id = ANY (v_docs) OR asset_id = ANY (v_assets) OR import_batch_id = b.id ORDER BY id FOR UPDATE) s;

  -- Ownership claims in client-written records that the server cannot prove: fail closed.
  SELECT count(DISTINCT r.asset_id) INTO n FROM public.asset_import_records r
  WHERE r.batch_id = b.id AND r.entity_type = 'asset' AND r.result IN ('created', 'merged_profile')
    AND r.asset_id IS NOT NULL AND NOT (r.asset_id = ANY (v_assets));
  IF n > 0 THEN
    v_reasons := v_reasons || format('%s asset(s) listed as created by this import cannot be confirmed as created by it (for example, imports run before ownership tracking existed). To protect them, nothing was removed. Review them manually.', n);
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT d.id FROM public.documents d WHERE d.import_batch_id = b.id AND NOT (d.id = ANY (v_docs))
    UNION
    SELECT r.document_id FROM public.asset_import_records r
    WHERE r.batch_id = b.id AND r.document_id IS NOT NULL AND r.result = 'created' AND NOT (r.document_id = ANY (v_docs))
  ) s;
  IF n > 0 THEN
    v_reasons := v_reasons || format('%s document(s) listed for this import cannot be confirmed as created by it. To protect them, nothing was removed.', n);
  END IF;
  SELECT count(*) INTO n FROM public.document_asset_links l
  WHERE l.import_batch_id = b.id AND NOT EXISTS (SELECT 1 FROM public.asset_import_entities e
    WHERE e.batch_id = b.id AND e.entity_type = 'document_asset_link' AND e.entity_id = l.id);
  IF n > 0 THEN
    v_reasons := v_reasons || format('%s document link(s) listed for this import cannot be confirmed as created by it.', n);
  END IF;

  SELECT count(*) INTO n FROM public.asset_import_records r
  WHERE r.batch_id = b.id AND r.entity_type = 'asset' AND r.result = 'updated' AND r.asset_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.asset_import_changes c
      WHERE c.batch_id = b.id AND c.entity_type = 'asset' AND c.entity_id = r.asset_id);
  IF n > 0 THEN
    v_reasons := v_reasons || format('%s existing asset(s) were updated by this import before change tracking existed. Their previous values were not saved, so an automatic undo could overwrite current data. Review those assets manually instead.', n);
  END IF;

  FOR rec IN
    SELECT e.entity_type, count(*) AS c FROM public.asset_import_entities e
    WHERE e.batch_id = b.id AND e.user_modified GROUP BY e.entity_type ORDER BY e.entity_type
  LOOP
    v_reasons := v_reasons || format('%s %s created by this import were changed by someone else after they were created.', rec.c,
      CASE rec.entity_type WHEN 'asset' THEN 'asset(s)' WHEN 'document' THEN 'document(s)'
        WHEN 'attribute_value' THEN 'technical value(s)' WHEN 'design_profile' THEN 'design profile(s)'
        WHEN 'relationship' THEN 'relationship(s)' ELSE 'document link(s)' END);
  END LOOP;

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
    SELECT count(*) INTO n FROM public.document_asset_links l
    WHERE l.asset_id = ANY (v_assets) AND NOT EXISTS (SELECT 1 FROM public.asset_import_entities e
      WHERE e.batch_id = b.id AND e.entity_type = 'document_asset_link' AND e.entity_id = l.id);
    IF n > 0 THEN v_reasons := v_reasons || format('%s document link(s) were added to imported assets outside this import.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_relationships x
    WHERE (x.source_asset_id = ANY (v_assets) OR x.target_asset_id = ANY (v_assets))
      AND NOT EXISTS (SELECT 1 FROM public.asset_import_entities e
        WHERE e.batch_id = b.id AND e.entity_type = 'relationship' AND e.entity_id = x.id);
    IF n > 0 THEN v_reasons := v_reasons || format('%s relationship(s) involving imported assets were added outside this import.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_design_profiles x
    WHERE x.asset_id = ANY (v_assets) AND NOT EXISTS (SELECT 1 FROM public.asset_import_entities e
      WHERE e.batch_id = b.id AND e.entity_type = 'design_profile' AND e.entity_id = x.id);
    IF n > 0 THEN v_reasons := v_reasons || format('%s design profile(s) were added to imported assets outside this import.', n); END IF;
    SELECT count(*) INTO n FROM public.asset_attribute_values x
    WHERE x.asset_id = ANY (v_assets) AND NOT EXISTS (SELECT 1 FROM public.asset_import_entities e
      WHERE e.batch_id = b.id AND e.entity_type = 'attribute_value' AND e.entity_id = x.id);
    IF n > 0 THEN v_reasons := v_reasons || format('%s technical value(s) were added to imported assets outside this import.', n); END IF;
    SELECT count(DISTINCT x.aid) INTO n FROM (
      SELECT r.asset_id AS aid FROM public.asset_import_records r WHERE r.asset_id = ANY (v_assets) AND r.batch_id <> b.id
      UNION ALL
      SELECT c.asset_id FROM public.asset_import_changes c WHERE c.asset_id = ANY (v_assets) AND c.batch_id <> b.id
    ) x;
    IF n > 0 THEN v_reasons := v_reasons || format('%s imported asset(s) were used by a later import.', n); END IF;
  END IF;

  IF cardinality(v_docs) > 0 THEN
    SELECT count(*) INTO n FROM public.document_asset_links l
    WHERE l.document_id = ANY (v_docs) AND NOT EXISTS (SELECT 1 FROM public.asset_import_entities e
      WHERE e.batch_id = b.id AND e.entity_type = 'document_asset_link' AND e.entity_id = l.id);
    IF n > 0 THEN v_reasons := v_reasons || format('%s link(s) to imported documents were added outside this import.', n); END IF;
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
    SELECT s.entity_id, jsonb_object_agg(s.k, s.last_after) AS expected
    FROM (
      SELECT c.entity_id, k.k, (array_agg(c.after_data -> k.k ORDER BY c.seq DESC))[1] AS last_after
      FROM public.asset_import_changes c CROSS JOIN LATERAL jsonb_object_keys(c.after_data) AS k(k)
      WHERE c.batch_id = b.id AND c.entity_type = 'asset' AND NOT (c.entity_id = ANY (v_assets))
      GROUP BY c.entity_id, k.k
    ) s GROUP BY s.entity_id
  LOOP
    IF EXISTS (SELECT 1 FROM public.assets a WHERE a.id = rec.entity_id AND (
      a.deleted_at IS NOT NULL OR
      EXISTS (SELECT 1 FROM jsonb_each(rec.expected) e WHERE to_jsonb(a) -> e.key IS DISTINCT FROM e.value))) THEN
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
    PERFORM set_config('xgfi.import_writer', '', true);
    RETURN jsonb_build_object('status', 'blocked', 'reasons', to_jsonb(v_reasons));
  END IF;

  BEGIN
    DELETE FROM public.document_asset_links l
    WHERE l.document_id = ANY (v_docs) OR EXISTS (SELECT 1 FROM public.asset_import_entities e
      WHERE e.batch_id = b.id AND e.entity_type = 'document_asset_link' AND e.entity_id = l.id);
    GET DIAGNOSTICS v_links = ROW_COUNT;
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
      SELECT s.entity_id, jsonb_object_agg(s.k, s.first_before) AS restore
      FROM (
        SELECT c.entity_id, k.k, (array_agg(c.before_data -> k.k ORDER BY c.seq))[1] AS first_before
        FROM public.asset_import_changes c CROSS JOIN LATERAL jsonb_object_keys(c.after_data) AS k(k)
        WHERE c.batch_id = b.id AND c.entity_type = 'asset' AND NOT (c.entity_id = ANY (v_assets))
        GROUP BY c.entity_id, k.k
      ) s GROUP BY s.entity_id
    LOOP
      IF EXISTS (SELECT 1 FROM public.assets WHERE id = rec.entity_id) THEN
        PERFORM public._import_apply_asset_fields(rec.entity_id, rec.restore);
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
    PERFORM set_config('xgfi.import_writer', '', true);
    RETURN v_details;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  INSERT INTO public.asset_import_rollback_attempts (batch_id, facility_id, attempted_by, outcome, details)
  VALUES (b.id, b.facility_id, v_uid, 'failed', jsonb_build_object('error', left(v_err, 1000)));
  INSERT INTO public.asset_import_records (batch_id, source_row, source_section, normalized_equipment_name, import_decision, result, entity_type, message)
  VALUES (b.id, 0, 'rollback', 'Import rollback', 'review', 'failed', 'record',
    left('Rollback failed and nothing was changed: ' || v_err, 2000));
  PERFORM set_config('xgfi.import_writer', '', true);
  RETURN jsonb_build_object('status', 'failed', 'reasons', jsonb_build_array('The rollback hit an unexpected error and nothing was changed: ' || left(v_err, 500)));
END $$;
