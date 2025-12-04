-- Allow anon/authenticated users to read from user-specific storage buckets so the UI can fetch files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Allow read access to user buckets'
  ) THEN
    CREATE POLICY "Allow read access to user buckets"
      ON storage.objects
      FOR SELECT
      TO anon, authenticated
      USING (bucket_id LIKE 'user-%');
  END IF;
END $$;


