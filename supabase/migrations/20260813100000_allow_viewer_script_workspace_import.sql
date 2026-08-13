drop policy if exists script_workspace_documents_insert
  on public.script_workspace_documents;

create policy script_workspace_documents_insert
  on public.script_workspace_documents for insert
  with check (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_accepted_collaborator(project_id, (select auth.uid()))
  );
