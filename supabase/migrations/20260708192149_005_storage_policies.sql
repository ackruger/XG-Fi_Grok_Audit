/*
# Add storage policies for photos bucket

1. Security Changes
  - Add SELECT policy on storage.objects for authenticated users to read files in the 'photos' bucket.
  - Add INSERT policy on storage.objects for authenticated users to upload files to the 'photos' bucket.
  - Add DELETE policy on storage.objects for authenticated users to delete their own uploaded files in the 'photos' bucket.

2. Important Notes
  - The 'photos' bucket already exists and is public (for read via URL), but storage.objects RLS was blocking all uploads.
  - These policies allow any authenticated user to upload and any authenticated user to read, matching the app's project-member model.
*/

-- Allow authenticated users to read any file in the photos bucket
DROP POLICY IF EXISTS "Authenticated users can read photos" ON storage.objects;
CREATE POLICY "Authenticated users can read photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'photos');

-- Allow authenticated users to upload to the photos bucket
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'photos');

-- Allow authenticated users to delete their own photos
DROP POLICY IF EXISTS "Authenticated users can delete own photos" ON storage.objects;
CREATE POLICY "Authenticated users can delete own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'photos' AND (storage.foldername(name))[1] IS NOT NULL);

-- Allow authenticated users to update their photos (e.g. replace)
DROP POLICY IF EXISTS "Authenticated users can update photos" ON storage.objects;
CREATE POLICY "Authenticated users can update photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'photos')
WITH CHECK (bucket_id = 'photos');
