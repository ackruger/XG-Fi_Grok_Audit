/*
# Make qr_code_id nullable on assets table

## Overview
The `qr_code_id` column on the `assets` table currently has a NOT NULL constraint,
but assets can legitimately be created without a QR code. This migration removes
the NOT NULL constraint so the field is optional.

## Modified Tables
- `assets`
  - `qr_code_id` (text) — changed from NOT NULL to nullable

## Security
- No changes to RLS policies.

## Notes
- The UNIQUE constraint on `qr_code_id` remains, allowing multiple NULLs
  (PostgreSQL treats NULLs as distinct for uniqueness).
*/

ALTER TABLE assets ALTER COLUMN qr_code_id DROP NOT NULL;
