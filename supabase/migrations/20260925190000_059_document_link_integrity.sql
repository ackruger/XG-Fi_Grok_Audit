/*
# Document Link Integrity and Import Deduplication

Strengthens the generic document model introduced in migration 058.

- Enforces that a document and linked asset belong to the same facility.
- Adds a unique partial index for normalized import document keys within a facility.
- Keeps facility-level documents valid because they require no asset link.
*/

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_facility_source_key_unique
  ON documents(facility_id, source_document_key)
  WHERE source_document_key IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION enforce_document_asset_same_facility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_document_facility uuid;
  v_asset_facility uuid;
BEGIN
  SELECT facility_id INTO v_document_facility
  FROM documents
  WHERE id = NEW.document_id AND deleted_at IS NULL;

  IF v_document_facility IS NULL THEN
    RAISE EXCEPTION 'Document not found or deleted: %', NEW.document_id;
  END IF;

  SELECT facility_id INTO v_asset_facility
  FROM assets
  WHERE id = NEW.asset_id AND deleted_at IS NULL;

  IF v_asset_facility IS NULL THEN
    RAISE EXCEPTION 'Asset not found or deleted: %', NEW.asset_id;
  END IF;

  IF v_document_facility <> v_asset_facility THEN
    RAISE EXCEPTION 'Document and asset must belong to the same facility';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enforce_document_asset_same_facility() FROM PUBLIC;

DROP TRIGGER IF EXISTS document_asset_same_facility ON document_asset_links;
CREATE TRIGGER document_asset_same_facility
  BEFORE INSERT OR UPDATE ON document_asset_links
  FOR EACH ROW
  EXECUTE FUNCTION enforce_document_asset_same_facility();
