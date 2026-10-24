/*
# Documents Model, Document-Asset Links, and Import Expansion

## Overview
Restructures the document model from single-asset ownership (asset_documents)
to a facility-scoped generic document model with many-to-many asset links.
Extends the import system for XLSX workbooks and multi-entity tracking.

## New Tables

### documents
  Facility-scoped generic document record. A document may belong to a facility
  only, or be linked to one or many assets via document_asset_links.

### document_asset_links
  Many-to-many relationship between documents and assets.
  Unique constraint: (document_id, asset_id) prevents duplicate links.

## New Functions
  - get_document_facility_id(uuid) - SECURITY DEFINER helper for RLS

## Modified Tables
  - asset_import_batches: added source_type, documents_created, document_links_created
  - asset_import_records: expanded CHECK constraints, added entity_type and document_id

## Data Migration
  - Copies existing asset_documents rows into documents + document_asset_links.
  - Does NOT drop or alter asset_documents.

## Security
  - RLS on documents: facility membership via is_facility_member / can_write_facility
  - RLS on document_asset_links: facility membership via get_document_facility_id
*/

-- ===== DOCUMENTS TABLE =====
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('shop_drawing','floorplan','specification','om_manual','commissioning','engineering','submittal','drawing','contractual','record','form','other')),
  document_type text,
  discipline text,
  document_status text,
  document_reference text,
  revision text,
  description text DEFAULT '',
  storage_provider text NOT NULL DEFAULT 'supabase'
    CHECK (storage_provider IN ('supabase','external','pending')),
  storage_path text,
  external_url text,
  file_size bigint,
  mime_type text,
  source_filename text,
  source_sheet text,
  source_row int,
  source_document_key text,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id),
  import_batch_id uuid REFERENCES asset_import_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_documents_facility ON documents(facility_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_import_batch ON documents(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_source_key ON documents(facility_id, source_document_key) WHERE source_document_key IS NOT NULL;

-- ===== DOCUMENT_ASSET_LINKS TABLE =====
CREATE TABLE IF NOT EXISTS document_asset_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'applies_to'
    CHECK (relationship_type IN ('applies_to','reference','supports','generated_from','related')),
  import_batch_id uuid REFERENCES asset_import_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, asset_id)
);

ALTER TABLE document_asset_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_doc_asset_links_document ON document_asset_links(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_asset_links_asset ON document_asset_links(asset_id);
CREATE INDEX IF NOT EXISTS idx_doc_asset_links_batch ON document_asset_links(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ===== SECURITY DEFINER HELPER =====
CREATE OR REPLACE FUNCTION get_document_facility_id(p_document_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT facility_id FROM documents WHERE id = p_document_id;
$$;

REVOKE ALL ON FUNCTION get_document_facility_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_document_facility_id(uuid) TO authenticated;

-- ===== DOCUMENTS RLS =====
DROP POLICY IF EXISTS "fac_documents_select" ON documents;
CREATE POLICY "fac_documents_select" ON documents FOR SELECT TO authenticated
  USING (is_facility_member(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_documents_insert" ON documents;
CREATE POLICY "fac_documents_insert" ON documents FOR INSERT TO authenticated
  WITH CHECK (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_documents_update" ON documents;
CREATE POLICY "fac_documents_update" ON documents FOR UPDATE TO authenticated
  USING (can_write_facility(facility_id, auth.uid()))
  WITH CHECK (can_write_facility(facility_id, auth.uid()));

DROP POLICY IF EXISTS "fac_documents_delete" ON documents;
CREATE POLICY "fac_documents_delete" ON documents FOR DELETE TO authenticated
  USING (can_write_facility(facility_id, auth.uid()));

-- ===== DOCUMENT_ASSET_LINKS RLS =====
DROP POLICY IF EXISTS "fac_doc_links_select" ON document_asset_links;
CREATE POLICY "fac_doc_links_select" ON document_asset_links FOR SELECT TO authenticated
  USING (is_facility_member(get_document_facility_id(document_id), auth.uid()));

DROP POLICY IF EXISTS "fac_doc_links_insert" ON document_asset_links;
CREATE POLICY "fac_doc_links_insert" ON document_asset_links FOR INSERT TO authenticated
  WITH CHECK (can_write_facility(get_document_facility_id(document_id), auth.uid()));

DROP POLICY IF EXISTS "fac_doc_links_update" ON document_asset_links;
CREATE POLICY "fac_doc_links_update" ON document_asset_links FOR UPDATE TO authenticated
  USING (can_write_facility(get_document_facility_id(document_id), auth.uid()))
  WITH CHECK (can_write_facility(get_document_facility_id(document_id), auth.uid()));

DROP POLICY IF EXISTS "fac_doc_links_delete" ON document_asset_links;
CREATE POLICY "fac_doc_links_delete" ON document_asset_links FOR DELETE TO authenticated
  USING (can_write_facility(get_document_facility_id(document_id), auth.uid()));

-- ===== EXTEND IMPORT BATCHES =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_import_batches' AND column_name='source_type') THEN
    ALTER TABLE asset_import_batches ADD COLUMN source_type text NOT NULL DEFAULT 'csv' CHECK (source_type IN ('csv','xlsx'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_import_batches' AND column_name='documents_created') THEN
    ALTER TABLE asset_import_batches ADD COLUMN documents_created int NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_import_batches' AND column_name='document_links_created') THEN
    ALTER TABLE asset_import_batches ADD COLUMN document_links_created int NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ===== EXTEND IMPORT RECORDS =====
ALTER TABLE asset_import_records
  DROP CONSTRAINT IF EXISTS asset_import_records_import_decision_check;
ALTER TABLE asset_import_records
  ADD CONSTRAINT asset_import_records_import_decision_check
  CHECK (import_decision IN ('ready','review','exclude','profile_merge','add','update','existing','hold'));

ALTER TABLE asset_import_records
  DROP CONSTRAINT IF EXISTS asset_import_records_result_check;
ALTER TABLE asset_import_records
  ADD CONSTRAINT asset_import_records_result_check
  CHECK (result IN ('created','merged_profile','skipped','review','failed','linked','deferred','updated'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_import_records' AND column_name='entity_type') THEN
    ALTER TABLE asset_import_records ADD COLUMN entity_type text NOT NULL DEFAULT 'asset'
      CHECK (entity_type IN ('asset','document','document_asset_link','record','deferred'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_import_records' AND column_name='document_id') THEN
    ALTER TABLE asset_import_records ADD COLUMN document_id uuid REFERENCES documents(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ===== DATA MIGRATION: asset_documents → documents + document_asset_links =====
DO $$
DECLARE
  r record;
  new_doc_id uuid;
  fac_id uuid;
  sp text;
BEGIN
  FOR r IN
    SELECT ad.*, a.facility_id AS asset_facility_id
    FROM asset_documents ad
    JOIN assets a ON a.id = ad.asset_id
    WHERE NOT EXISTS (
      SELECT 1 FROM documents d
      WHERE d.facility_id = a.facility_id
        AND d.name = ad.name
        AND d.storage_path IS NOT DISTINCT FROM ad.storage_path
        AND d.source_filename = 'migrated_from_asset_documents'
    )
  LOOP
    fac_id := r.asset_facility_id;
    IF r.storage_path IS NOT NULL THEN
      sp := 'supabase';
    ELSIF r.external_url IS NOT NULL THEN
      sp := 'external';
    ELSE
      sp := 'pending';
    END IF;

    INSERT INTO documents (
      facility_id, name, category, description,
      storage_provider, storage_path, external_url,
      file_size, mime_type, source_filename,
      created_by, created_at, updated_at
    ) VALUES (
      fac_id, r.name, r.category, COALESCE(r.description, ''),
      sp, r.storage_path, r.external_url,
      r.file_size, r.mime_type, 'migrated_from_asset_documents',
      r.uploaded_by, r.created_at, r.updated_at
    )
    RETURNING id INTO new_doc_id;

    INSERT INTO document_asset_links (document_id, asset_id, relationship_type, created_at)
    VALUES (new_doc_id, r.asset_id, 'applies_to', r.created_at)
    ON CONFLICT (document_id, asset_id) DO NOTHING;
  END LOOP;
END $$;
