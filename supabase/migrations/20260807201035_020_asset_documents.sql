/*
# Create asset_documents table and private storage bucket

## Overview
Creates the asset_documents table for tracking uploaded files associated with
assets, and a PRIVATE storage bucket for secure document storage. Documents
are accessed via signed URLs (not public URLs) to protect sensitive project files.

## New Tables
1. `asset_documents`
   - `id` (uuid, PK) — unique identifier
   - `asset_id` (uuid, FK to assets, NOT NULL) — which asset this document belongs to
   - `name` (text, NOT NULL) — user-facing document name
   - `category` (text, NOT NULL) — document type: shop_drawing, floorplan, specification,
     om_manual, commissioning, other
   - `storage_path` (text, NOT NULL) — path within the asset-documents bucket
   - `file_size` (bigint) — file size in bytes
   - `mime_type` (text) — MIME type of the file
   - `uploaded_by` (uuid, FK to profiles, NOT NULL) — who uploaded it
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Storage
- Creates a PRIVATE bucket named `asset-documents`.
- Storage policies scope access through asset → project → project_members.
- SELECT (download): any project member.
- INSERT (upload): contributor, reviewer, supervisor, admin.
- DELETE: supervisor, admin (file owner can also delete their own uploads).

## Indexes
- Index on asset_id for asset-scoped lookups
- Index on category for filtered views

## Security
- RLS enabled on asset_documents table.
- Storage bucket is PRIVATE — files are only accessible via signed URLs.
- Both table RLS and storage policies enforce project membership.
*/

CREATE TABLE IF NOT EXISTS asset_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('shop_drawing', 'floorplan', 'specification', 'om_manual', 'commissioning', 'other')),
  storage_path text NOT NULL,
  file_size bigint,
  mime_type text DEFAULT '',
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_asset_docs_asset_id ON asset_documents(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_docs_category ON asset_documents(category);

DROP POLICY IF EXISTS "asset_docs_select" ON asset_documents;
CREATE POLICY "asset_docs_select" ON asset_documents FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_documents.asset_id
      AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "asset_docs_insert" ON asset_documents;
CREATE POLICY "asset_docs_insert" ON asset_documents FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_documents.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "asset_docs_update" ON asset_documents;
CREATE POLICY "asset_docs_update" ON asset_documents FOR UPDATE
  TO authenticated USING (
    asset_documents.uploaded_by = auth.uid() OR EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_documents.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  ) WITH CHECK (
    asset_documents.uploaded_by = auth.uid() OR EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_documents.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "asset_docs_delete" ON asset_documents;
CREATE POLICY "asset_docs_delete" ON asset_documents FOR DELETE
  TO authenticated USING (
    asset_documents.uploaded_by = auth.uid() OR EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_documents.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );

-- Create private storage bucket for asset documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-documents', 'asset-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: SELECT (download) — project members can download
DROP POLICY IF EXISTS "asset_docs_storage_select" ON storage.objects;
CREATE POLICY "asset_docs_storage_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'asset-documents'
    AND EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.project_id = (
        SELECT a2.project_id FROM assets a2
        WHERE a2.id::text = (string_to_array(storage.objects.name, '/'))[1]
      )
      AND project_members.user_id = auth.uid()
    )
  );

-- Storage policies: INSERT (upload) — contributor+ can upload
DROP POLICY IF EXISTS "asset_docs_storage_insert" ON storage.objects;
CREATE POLICY "asset_docs_storage_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'asset-documents'
    AND EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id::text = (string_to_array(storage.objects.name, '/'))[1]
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

-- Storage policies: DELETE — supervisor/admin or file owner
DROP POLICY IF EXISTS "asset_docs_storage_delete" ON storage.objects;
CREATE POLICY "asset_docs_storage_delete" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'asset-documents'
    AND (
      auth.uid() = owner
      OR EXISTS (
        SELECT 1 FROM project_members
        WHERE project_members.project_id::text = (string_to_array(storage.objects.name, '/'))[1]
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('supervisor', 'admin')
      )
    )
  );
