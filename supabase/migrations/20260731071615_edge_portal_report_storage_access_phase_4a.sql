DROP POLICY IF EXISTS blade_reports_select_authorized ON storage.objects;

CREATE POLICY blade_reports_select_authorized
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'blade-reports'
  AND (
    private.is_staff((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.player_access AS pa
      WHERE pa.player_id::text = (storage.foldername(name))[1]
        AND pa.user_id = (SELECT auth.uid())
        AND pa.revoked_at IS NULL
    )
  )
);
