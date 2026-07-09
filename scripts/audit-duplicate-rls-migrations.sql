-- Read-only audit for duplicate optimize_rls_performance migrations.
--
-- Run this with sufficient privileges in each Supabase environment before any
-- cleanup decision. If either version is present, preserve the historical
-- filename in the repository; do not delete applied migration history.

WITH expected(version) AS (
  VALUES
    ('20260109000001'),
    ('20260109000002')
)
SELECT
  expected.version,
  EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations AS applied
    WHERE applied.version = expected.version
  ) AS applied
FROM expected
ORDER BY expected.version;
