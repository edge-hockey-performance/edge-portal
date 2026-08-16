-- Apply only after the signed-URL client is deployed and verified in staging.
UPDATE storage.buckets
SET public = false
WHERE id = 'blade-reports';
