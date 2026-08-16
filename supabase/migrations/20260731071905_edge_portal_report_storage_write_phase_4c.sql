DROP POLICY IF EXISTS blade_reports_upload_authenticated ON storage.objects;

CREATE POLICY blade_reports_upload_authorized
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'blade-reports'
  AND (
    private.is_staff((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.player_access AS pa
      WHERE pa.player_id::text = (storage.foldername(name))[1]
        AND pa.user_id = (SELECT auth.uid())
        AND pa.revoked_at IS NULL
        AND pa.relationship IN ('self', 'parent', 'guardian')
    )
  )
);
