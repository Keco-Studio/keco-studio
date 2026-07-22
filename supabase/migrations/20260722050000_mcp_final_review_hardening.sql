-- Final MCP Phase 2 review hardening: index-backed text search and canonical references.

CREATE TABLE public.mcp_search_documents (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('library_schema', 'library_row', 'project_document')
  ),
  source_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  search_text TEXT GENERATED ALWAYS AS (
    lower(coalesce(title, '') || ' ' || coalesce(body, ''))
  ) STORED,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(body, ''))
  ) STORED,
  PRIMARY KEY (source_type, source_id)
);

CREATE INDEX mcp_search_documents_project_source_idx
  ON public.mcp_search_documents (project_id, source_type, updated_at DESC, source_id);
CREATE INDEX mcp_search_documents_search_vector_idx
  ON public.mcp_search_documents USING GIN (search_vector);
CREATE INDEX mcp_search_documents_search_text_trgm_idx
  ON public.mcp_search_documents USING GIN (search_text extensions.gin_trgm_ops);

ALTER TABLE public.mcp_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_search_documents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_search_documents FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_refresh_library_search(p_library_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.mcp_search_documents
  WHERE source_type = 'library_schema' AND source_id = p_library_id;

  INSERT INTO public.mcp_search_documents (
    project_id, source_type, source_id, title, body, updated_at
  )
  SELECT
    library.project_id,
    'library_schema',
    library.id,
    library.name,
    concat_ws(
      ' ',
      library.description,
      string_agg(
        concat_ws(' ', field.label, field.description, field.data_type),
        ' ' ORDER BY field.order_index, field.id
      )
    ),
    library.updated_at
  FROM public.libraries AS library
  LEFT JOIN public.library_field_definitions AS field
    ON field.library_id = library.id
  WHERE library.id = p_library_id
  GROUP BY library.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_refresh_library_row_search(p_row_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.mcp_search_documents
  WHERE source_type = 'library_row' AND source_id = p_row_id;

  INSERT INTO public.mcp_search_documents (
    project_id, source_type, source_id, title, body, updated_at
  )
  SELECT
    library.project_id,
    'library_row',
    asset.id,
    coalesce(nullif(asset.name, ''), 'Untitled row'),
    concat_ws(
      ' ',
      asset.name,
      string_agg(
        concat_ws(' ', field.label, value.value_json::TEXT),
        ' ' ORDER BY field.order_index, field.id
      )
    ),
    asset.updated_at
  FROM public.library_assets AS asset
  JOIN public.libraries AS library ON library.id = asset.library_id
  LEFT JOIN public.library_asset_values AS value ON value.asset_id = asset.id
  LEFT JOIN public.library_field_definitions AS field ON field.id = value.field_id
  WHERE asset.id = p_row_id
  GROUP BY asset.id, library.project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_refresh_document_search(p_document_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.mcp_search_documents
  WHERE source_type = 'project_document' AND source_id = p_document_id;

  INSERT INTO public.mcp_search_documents (
    project_id, source_type, source_id, title, body, updated_at
  )
  SELECT
    document.project_id,
    'project_document',
    document.id,
    document.name,
    document.content,
    document.updated_at
  FROM public.documents AS document
  WHERE document.id = p_document_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_sync_library_search()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.mcp_search_documents
    WHERE source_type = 'library_schema' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.mcp_refresh_library_search(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_sync_library_field_search()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.mcp_refresh_library_search(OLD.library_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR NEW.library_id IS DISTINCT FROM OLD.library_id
  ) THEN
    PERFORM public.mcp_refresh_library_search(NEW.library_id);
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_sync_library_row_search()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.mcp_search_documents
    WHERE source_type = 'library_row' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.mcp_refresh_library_row_search(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_sync_library_value_search()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.mcp_refresh_library_row_search(OLD.asset_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
  ) THEN
    PERFORM public.mcp_refresh_library_row_search(NEW.asset_id);
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_sync_document_search()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.mcp_search_documents
    WHERE source_type = 'project_document' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.mcp_refresh_document_search(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_sync_library_search_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.libraries
FOR EACH ROW EXECUTE FUNCTION public.mcp_sync_library_search();
CREATE TRIGGER mcp_sync_library_field_search_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.library_field_definitions
FOR EACH ROW EXECUTE FUNCTION public.mcp_sync_library_field_search();
CREATE TRIGGER mcp_sync_library_row_search_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.library_assets
FOR EACH ROW EXECUTE FUNCTION public.mcp_sync_library_row_search();
CREATE TRIGGER mcp_sync_library_value_search_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.library_asset_values
FOR EACH ROW EXECUTE FUNCTION public.mcp_sync_library_value_search();
CREATE TRIGGER mcp_sync_document_search_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.mcp_sync_document_search();

INSERT INTO public.mcp_search_documents (
  project_id, source_type, source_id, title, body, updated_at
)
SELECT
  library.project_id,
  'library_schema',
  library.id,
  library.name,
  concat_ws(
    ' ',
    library.description,
    string_agg(
      concat_ws(' ', field.label, field.description, field.data_type),
      ' ' ORDER BY field.order_index, field.id
    )
  ),
  library.updated_at
FROM public.libraries AS library
LEFT JOIN public.library_field_definitions AS field ON field.library_id = library.id
GROUP BY library.id;

INSERT INTO public.mcp_search_documents (
  project_id, source_type, source_id, title, body, updated_at
)
SELECT
  library.project_id,
  'library_row',
  asset.id,
  coalesce(nullif(asset.name, ''), 'Untitled row'),
  concat_ws(
    ' ',
    asset.name,
    string_agg(
      concat_ws(' ', field.label, value.value_json::TEXT),
      ' ' ORDER BY field.order_index, field.id
    )
  ),
  asset.updated_at
FROM public.library_assets AS asset
JOIN public.libraries AS library ON library.id = asset.library_id
LEFT JOIN public.library_asset_values AS value ON value.asset_id = asset.id
LEFT JOIN public.library_field_definitions AS field ON field.id = value.field_id
GROUP BY asset.id, library.project_id;

INSERT INTO public.mcp_search_documents (
  project_id, source_type, source_id, title, body, updated_at
)
SELECT
  document.project_id,
  'project_document',
  document.id,
  document.name,
  document.content,
  document.updated_at
FROM public.documents AS document;

CREATE OR REPLACE FUNCTION public.mcp_text_search(
  p_project_id UUID,
  p_query TEXT,
  p_limit INTEGER DEFAULT 10,
  p_source TEXT DEFAULT 'all'
)
RETURNS TABLE (
  source_type TEXT,
  source_id TEXT,
  title TEXT,
  excerpt TEXT,
  score DOUBLE PRECISION,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_query TEXT := btrim(p_query);
  v_candidate_limit INTEGER;
BEGIN
  IF public.mcp_current_project_role(p_project_id) IS NULL THEN
    RAISE EXCEPTION 'Project access revoked' USING ERRCODE = '42501';
  END IF;
  IF v_query = '' OR length(v_query) > 1000 OR p_limit NOT BETWEEN 1 AND 30
    OR p_source NOT IN ('all', 'tables', 'documents') THEN
    RAISE EXCEPTION 'Invalid search options' USING ERRCODE = '22023';
  END IF;

  v_candidate_limit := least(120, greatest(40, p_limit * 4));
  PERFORM set_config('pg_trgm.similarity_threshold', '0.1', true);

  RETURN QUERY
  WITH search_query AS MATERIALIZED (
    SELECT plainto_tsquery('simple'::regconfig, v_query) AS value
  ),
  table_fts AS MATERIALIZED (
    SELECT document.*,
      ts_rank_cd(document.search_vector, query.value)::DOUBLE PRECISION AS rank_score
    FROM public.mcp_search_documents AS document
    CROSS JOIN search_query AS query
    WHERE document.project_id = p_project_id
      AND document.source_type IN ('library_schema', 'library_row')
      AND p_source IN ('all', 'tables')
      AND document.search_vector @@ query.value
    ORDER BY rank_score DESC, document.updated_at DESC, document.source_id
    LIMIT v_candidate_limit
  ),
  document_fts AS MATERIALIZED (
    SELECT document.*,
      ts_rank_cd(document.search_vector, query.value)::DOUBLE PRECISION AS rank_score
    FROM public.mcp_search_documents AS document
    CROSS JOIN search_query AS query
    WHERE document.project_id = p_project_id
      AND document.source_type = 'project_document'
      AND p_source IN ('all', 'documents')
      AND document.search_vector @@ query.value
    ORDER BY rank_score DESC, document.updated_at DESC, document.source_id
    LIMIT v_candidate_limit
  ),
  table_fuzzy AS MATERIALIZED (
    SELECT document.*,
      extensions.similarity(document.search_text, lower(v_query))::DOUBLE PRECISION AS rank_score
    FROM public.mcp_search_documents AS document
    WHERE length(v_query) >= 3
      AND document.project_id = p_project_id
      AND document.source_type IN ('library_schema', 'library_row')
      AND p_source IN ('all', 'tables')
      AND (
        document.search_text OPERATOR(extensions.%) lower(v_query)
        OR document.search_text LIKE '%' || lower(v_query) || '%'
      )
    ORDER BY rank_score DESC, document.updated_at DESC, document.source_id
    LIMIT v_candidate_limit
  ),
  document_fuzzy AS MATERIALIZED (
    SELECT document.*,
      extensions.similarity(document.search_text, lower(v_query))::DOUBLE PRECISION AS rank_score
    FROM public.mcp_search_documents AS document
    WHERE length(v_query) >= 3
      AND document.project_id = p_project_id
      AND document.source_type = 'project_document'
      AND p_source IN ('all', 'documents')
      AND (
        document.search_text OPERATOR(extensions.%) lower(v_query)
        OR document.search_text LIKE '%' || lower(v_query) || '%'
      )
    ORDER BY rank_score DESC, document.updated_at DESC, document.source_id
    LIMIT v_candidate_limit
  ),
  candidates AS (
    SELECT * FROM table_fts
    UNION ALL SELECT * FROM document_fts
    UNION ALL SELECT * FROM table_fuzzy
    UNION ALL SELECT * FROM document_fuzzy
  ),
  deduplicated AS (
    SELECT DISTINCT ON (candidate.source_type, candidate.source_id)
      candidate.*
    FROM candidates AS candidate
    ORDER BY candidate.source_type, candidate.source_id, candidate.rank_score DESC
  )
  SELECT
    candidate.source_type,
    candidate.source_id::TEXT,
    candidate.title,
    left(candidate.body, 500),
    candidate.rank_score,
    candidate.updated_at
  FROM deduplicated AS candidate
  ORDER BY candidate.rank_score DESC, candidate.updated_at DESC,
    candidate.source_type, candidate.source_id
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_canonical_reference_value(p_value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item JSONB;
  v_asset_id UUID;
  v_field_id UUID;
  v_result JSONB := '[]'::JSONB;
BEGIN
  IF jsonb_typeof(p_value) NOT IN ('object', 'array')
    OR jsonb_typeof(p_value) = 'array' AND jsonb_array_length(p_value) = 0 THEN
    RAISE EXCEPTION 'Invalid reference value' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_value) = 'array'
        THEN p_value ELSE jsonb_build_array(p_value) END
    )
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v_item) AS key)
        IS DISTINCT FROM ARRAY['assetId', 'fieldId']::TEXT[]
      OR jsonb_typeof(v_item -> 'assetId') <> 'string'
      OR jsonb_typeof(v_item -> 'fieldId') <> 'string' THEN
      RAISE EXCEPTION 'Reference entries require exactly assetId and fieldId'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_asset_id := (v_item ->> 'assetId')::UUID;
      v_field_id := (v_item ->> 'fieldId')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid reference identifiers' USING ERRCODE = '22023';
    END;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'assetId', v_asset_id::TEXT,
      'fieldId', v_field_id::TEXT
    ));
  END LOOP;

  RETURN CASE WHEN jsonb_typeof(p_value) = 'array'
    THEN v_result ELSE v_result -> 0 END;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_validate_field_value(
  p_project_id UUID,
  p_table_id UUID,
  p_field public.library_field_definitions,
  p_value JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_item JSONB;
  v_asset UUID;
  v_field UUID;
  v_target_table UUID;
  v_date DATE;
  v_canonical JSONB;
BEGIN
  IF p_field.data_type IS NULL OR p_field.data_type IN (
    'formula', 'image', 'file', 'multimedia', 'audio', 'media'
  ) THEN
    RAISE EXCEPTION 'Field type is not MCP writable' USING ERRCODE = '22023';
  END IF;
  IF public.mcp_value_is_empty(p_value) THEN RETURN; END IF;
  IF p_field.data_type = 'string' AND jsonb_typeof(p_value) <> 'string'
    OR p_field.data_type = 'boolean' AND jsonb_typeof(p_value) <> 'boolean'
    OR p_field.data_type IN ('int', 'float') AND jsonb_typeof(p_value) <> 'number'
    OR p_field.data_type IN ('string_array', 'int_array', 'float_array')
       AND jsonb_typeof(p_value) <> 'array' THEN
    RAISE EXCEPTION 'Field value has the wrong type' USING ERRCODE = '22023';
  END IF;
  IF p_field.data_type = 'int'
    AND (p_value #>> '{}')::NUMERIC <> trunc((p_value #>> '{}')::NUMERIC) THEN
    RAISE EXCEPTION 'Integer field requires an integer' USING ERRCODE = '22023';
  END IF;
  IF p_field.data_type IN ('string_array', 'int_array', 'float_array') THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF p_field.data_type = 'string_array' AND jsonb_typeof(v_item) <> 'string'
        OR p_field.data_type IN ('int_array', 'float_array')
           AND jsonb_typeof(v_item) <> 'number' THEN
        RAISE EXCEPTION 'Array field contains an element of the wrong type'
          USING ERRCODE = '22023';
      END IF;
      IF p_field.data_type = 'int_array'
        AND (v_item #>> '{}')::NUMERIC <> trunc((v_item #>> '{}')::NUMERIC) THEN
        RAISE EXCEPTION 'Integer array requires integer elements' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  IF p_field.data_type = 'date' THEN
    IF jsonb_typeof(p_value) <> 'string'
      OR (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Date field requires YYYY-MM-DD' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_date := (p_value #>> '{}')::DATE;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Date field requires a real calendar date' USING ERRCODE = '22023';
    END;
    IF pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> (p_value #>> '{}') THEN
      RAISE EXCEPTION 'Date field requires a real calendar date' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_field.data_type = 'enum' AND (
    jsonb_typeof(p_value) <> 'string'
    OR NOT ((p_value #>> '{}') = ANY(coalesce(p_field.enum_options, ARRAY[]::TEXT[])))
  ) THEN
    RAISE EXCEPTION 'Invalid enum value' USING ERRCODE = '22023';
  END IF;
  IF p_field.data_type = 'reference' THEN
    v_canonical := public.mcp_canonical_reference_value(p_value);
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_canonical) = 'array'
          THEN v_canonical ELSE jsonb_build_array(v_canonical) END
      )
    LOOP
      v_asset := (v_item ->> 'assetId')::UUID;
      v_field := (v_item ->> 'fieldId')::UUID;
      SELECT asset.library_id INTO v_target_table
      FROM public.library_assets AS asset
      JOIN public.libraries AS library
        ON library.id = asset.library_id AND library.project_id = p_project_id
      JOIN public.library_field_definitions AS field
        ON field.id = v_field AND field.library_id = asset.library_id
      WHERE asset.id = v_asset;
      IF v_target_table IS NULL OR NOT (v_target_table = ANY(coalesce(
        p_field.reference_libraries, ARRAY[]::UUID[]
      ))) THEN
        RAISE EXCEPTION 'Reference target is outside the allowed project table'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_values(
  p_project_id UUID,
  p_table_id UUID,
  p_values JSONB,
  p_existing JSONB DEFAULT '{}'::JSONB,
  p_require_all BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_result JSONB := coalesce(p_existing, '{}'::JSONB);
  v_pair RECORD;
  v_field public.library_field_definitions%ROWTYPE;
  v_count INTEGER;
  v_value JSONB;
BEGIN
  IF jsonb_typeof(p_values) <> 'object' OR p_values = '{}'::JSONB
    OR pg_catalog.octet_length(p_values::TEXT) >= 262144 THEN
    RAISE EXCEPTION 'Values must be a bounded non-empty object' USING ERRCODE = '22023';
  END IF;
  FOR v_pair IN SELECT * FROM jsonb_each(p_values) LOOP
    SELECT count(*) INTO v_count
    FROM public.library_field_definitions AS field
    WHERE field.library_id = p_table_id
      AND (field.label = v_pair.key
        OR lower(btrim(field.label)) = lower(btrim(v_pair.key)));
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Unknown or ambiguous field label' USING ERRCODE = '22023';
    END IF;
    SELECT field.* INTO v_field
    FROM public.library_field_definitions AS field
    WHERE field.library_id = p_table_id
      AND (field.label = v_pair.key
        OR lower(btrim(field.label)) = lower(btrim(v_pair.key)))
    ORDER BY CASE WHEN field.label = v_pair.key THEN 0 ELSE 1 END, field.id
    LIMIT 1;
    PERFORM public.mcp_validate_field_value(
      p_project_id, p_table_id, v_field, v_pair.value
    );
    v_value := CASE WHEN v_field.data_type = 'reference'
      AND NOT public.mcp_value_is_empty(v_pair.value)
      THEN public.mcp_canonical_reference_value(v_pair.value)
      ELSE v_pair.value END;
    v_result := jsonb_set(v_result, ARRAY[v_field.id::TEXT], v_value, true);
  END LOOP;
  IF p_require_all THEN
    FOR v_field IN
      SELECT field.* FROM public.library_field_definitions AS field
      WHERE field.library_id = p_table_id AND field.data_type = 'boolean'
    LOOP
      IF NOT (v_result ? v_field.id::TEXT) THEN
        v_result := jsonb_set(
          v_result, ARRAY[v_field.id::TEXT], 'false'::JSONB, true
        );
      END IF;
    END LOOP;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.library_field_definitions AS field
    WHERE field.library_id = p_table_id AND coalesce(field.required, false)
      AND public.mcp_value_is_empty(v_result -> field.id::TEXT)
  ) THEN
    RAISE EXCEPTION 'Required field is empty' USING ERRCODE = '22023';
  END IF;
  RETURN v_result;
END;
$$;

-- Qualify document columns because RETURNS TABLE output names are PL/pgSQL
-- variables too. This replacement repairs environments where the original
-- migration has already been applied.
CREATE OR REPLACE FUNCTION public.mcp_create_document(
  p_project_id UUID,
  p_document_id UUID,
  p_folder_id UUID,
  p_name TEXT,
  p_markdown TEXT,
  p_yjs_state TEXT,
  p_allow_duplicate BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  document_id UUID,
  project_id UUID,
  folder_id UUID,
  name TEXT,
  content TEXT,
  collab_epoch BIGINT,
  collab_revision BIGINT,
  collab_epoch_reason TEXT,
  update_ids UUID[],
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor UUID;
  v_name TEXT := btrim(p_name);
  v_doc public.documents%ROWTYPE;
BEGIN
  v_actor := public.mcp_require_writer(p_project_id);
  PERFORM public.assert_document_snapshot_payload(p_yjs_state, p_markdown);
  IF p_document_id IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid document input' USING ERRCODE = '22023';
  END IF;
  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.folders AS folder
    WHERE folder.id = p_folder_id AND folder.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Folder is outside project' USING ERRCODE = '23503';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_project_id::TEXT || ':' || coalesce(p_folder_id::TEXT, '') || ':' || lower(v_name),
    0
  ));
  IF NOT p_allow_duplicate AND EXISTS (
    SELECT 1
    FROM public.documents AS document
    WHERE document.project_id = p_project_id
      AND document.folder_id IS NOT DISTINCT FROM p_folder_id
      AND document.name = v_name
  ) THEN
    RAISE EXCEPTION 'Document name already exists' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.documents (
    id, project_id, folder_id, name, content, yjs_state, collab_epoch,
    collab_revision, collab_epoch_reason, created_by
  ) VALUES (
    p_document_id, p_project_id, p_folder_id, v_name, p_markdown,
    p_yjs_state, 0, 1, 'initialize', v_actor
  )
  RETURNING * INTO v_doc;
  RETURN QUERY SELECT
    v_doc.id,
    v_doc.project_id,
    v_doc.folder_id,
    v_doc.name,
    v_doc.content,
    v_doc.collab_epoch,
    v_doc.collab_revision,
    v_doc.collab_epoch_reason,
    ARRAY[]::UUID[],
    v_doc.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_replace_document_content(
  p_project_id UUID,
  p_document_id UUID,
  p_actor_user_id UUID,
  p_backup_version_id UUID,
  p_expected_epoch BIGINT,
  p_expected_revision BIGINT,
  p_expected_update_ids UUID[],
  p_current_yjs_state TEXT,
  p_current_markdown TEXT,
  p_replacement_yjs_state TEXT,
  p_replacement_markdown TEXT
)
RETURNS TABLE (
  document_id UUID,
  collab_epoch BIGINT,
  collab_revision BIGINT,
  collab_epoch_reason TEXT,
  updated_at TIMESTAMPTZ,
  backup_version_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc public.documents%ROWTYPE;
  v_tail UUID[];
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_document_snapshot_payload(
    p_current_yjs_state, p_current_markdown
  );
  PERFORM public.assert_document_snapshot_payload(
    p_replacement_yjs_state, p_replacement_markdown
  );
  SELECT document.* INTO v_doc
  FROM public.documents AS document
  WHERE document.id = p_document_id AND document.project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND OR p_actor_user_id IS NULL OR NOT (
    public.is_project_owner(p_project_id, p_actor_user_id)
    OR public.is_editor_or_admin_collaborator(p_project_id, p_actor_user_id)
  ) THEN
    RAISE EXCEPTION 'Document not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF v_doc.yjs_state IS NULL
    OR v_doc.collab_epoch <> p_expected_epoch
    OR v_doc.collab_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Document collaboration token changed' USING ERRCODE = 'PT409';
  END IF;
  SELECT coalesce(
    array_agg(update_row.id ORDER BY update_row.created_at, update_row.id),
    ARRAY[]::UUID[]
  ) INTO v_tail
  FROM public.document_yjs_updates AS update_row
  WHERE update_row.document_id = p_document_id
    AND update_row.epoch = v_doc.collab_epoch;
  IF v_tail <> coalesce(p_expected_update_ids, ARRAY[]::UUID[]) THEN
    RAISE EXCEPTION 'Document update tail changed' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.document_versions (
    id, document_id, project_id, name, version_type, snapshot_yjs_state,
    snapshot_content, snapshot_epoch, snapshot_revision, created_by
  ) VALUES (
    p_backup_version_id, p_document_id, p_project_id, 'Before MCP edit',
    'pre_agent', p_current_yjs_state, p_current_markdown, v_doc.collab_epoch,
    v_doc.collab_revision, p_actor_user_id
  );
  UPDATE public.documents AS document
  SET yjs_state = p_replacement_yjs_state,
    content = p_replacement_markdown,
    collab_epoch = v_doc.collab_epoch + 1,
    collab_revision = v_doc.collab_revision + 1,
    collab_epoch_reason = 'agent',
    updated_at = pg_catalog.now()
  WHERE document.id = p_document_id;
  DELETE FROM public.document_yjs_updates AS update_row
  WHERE update_row.document_id = p_document_id
    AND update_row.epoch = v_doc.collab_epoch;
  RETURN QUERY SELECT
    document.id,
    document.collab_epoch,
    document.collab_revision,
    document.collab_epoch_reason,
    document.updated_at,
    p_backup_version_id
  FROM public.documents AS document
  WHERE document.id = p_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_refresh_library_search(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_refresh_library_row_search(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_refresh_document_search(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_sync_library_search()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_sync_library_field_search()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_sync_library_row_search()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_sync_library_value_search()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_sync_document_search()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_canonical_reference_value(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_validate_field_value(
  UUID, UUID, public.library_field_definitions, JSONB
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_resolve_values(UUID, UUID, JSONB, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_create_document(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_create_document(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;
REVOKE ALL ON FUNCTION public.mcp_replace_document_content(
  UUID, UUID, UUID, UUID, BIGINT, BIGINT, UUID[], TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_replace_document_content(
  UUID, UUID, UUID, UUID, BIGINT, BIGINT, UUID[], TEXT, TEXT, TEXT, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_text_search(UUID, TEXT, INTEGER, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_text_search(UUID, TEXT, INTEGER, TEXT)
  TO authenticated;
