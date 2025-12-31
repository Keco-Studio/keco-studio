-- 方案1：保留 RLS 但将策略改为只允许已认证用户访问
-- 这样比 `to public` 更安全，同时代码层仍然作为主要权限控制

-- 注意：这个方案仍然会允许所有已认证用户访问所有数据
-- 真正的权限控制依赖于代码层的验证
-- 如果完全不想依赖 RLS，请使用 20251230000000_disable_rls_for_code_based_auth.sql

-- 更新 projects 表的策略 - 替换现有的策略为允许所有已认证用户
drop policy if exists projects_select_policy on public.projects;
drop policy if exists projects_insert_policy on public.projects;
drop policy if exists projects_update_policy on public.projects;
drop policy if exists projects_delete_policy on public.projects;

create policy projects_select_policy on public.projects
  for select to authenticated using (true);

create policy projects_insert_policy on public.projects
  for insert to authenticated with check (true);

create policy projects_update_policy on public.projects
  for update to authenticated using (true) with check (true);

create policy projects_delete_policy on public.projects
  for delete to authenticated using (true);

-- 更新 libraries 表的策略
drop policy if exists libraries_select_policy on public.libraries;
drop policy if exists libraries_insert_policy on public.libraries;
drop policy if exists libraries_update_policy on public.libraries;
drop policy if exists libraries_delete_policy on public.libraries;

create policy libraries_select_policy on public.libraries
  for select to authenticated using (true);

create policy libraries_insert_policy on public.libraries
  for insert to authenticated with check (true);

create policy libraries_update_policy on public.libraries
  for update to authenticated using (true) with check (true);

create policy libraries_delete_policy on public.libraries
  for delete to authenticated using (true);

-- 更新 folders 表的策略
drop policy if exists folders_select_policy on public.folders;
drop policy if exists folders_insert_policy on public.folders;
drop policy if exists folders_update_policy on public.folders;
drop policy if exists folders_delete_policy on public.folders;

create policy folders_select_policy on public.folders
  for select to authenticated using (true);

create policy folders_insert_policy on public.folders
  for insert to authenticated with check (true);

create policy folders_update_policy on public.folders
  for update to authenticated using (true) with check (true);

create policy folders_delete_policy on public.folders
  for delete to authenticated using (true);

-- library_assets 和 library_asset_values 的策略已经是 to authenticated，不需要修改
-- library_field_definitions 的策略也已经是 to authenticated，不需要修改

