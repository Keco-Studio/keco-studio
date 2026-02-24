-- ================================================
-- 本地Supabase - 启用Realtime功能
-- ================================================
-- 
-- 在本地Supabase Studio中运行此脚本
-- 访问: http://localhost:54323 (或你的本地端口)
-- 点击: SQL Editor -> New Query
-- 
-- ================================================

-- 1. 启用Realtime for libraries表 (library创建/删除/修改)
ALTER PUBLICATION supabase_realtime ADD TABLE public.libraries;

-- 2. 启用Realtime for folders表 (folder创建/删除/修改)
ALTER PUBLICATION supabase_realtime ADD TABLE public.folders;

-- 3. 启用Realtime for predefine_properties表 (predefine配置变化)
ALTER PUBLICATION supabase_realtime ADD TABLE public.predefine_properties;

-- 4. 启用Realtime for project_collaborators表 (权限变化)
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_collaborators;

-- ================================================
-- 验证配置是否成功
-- ================================================
-- 运行下面的查询来检查哪些表已启用Realtime:

SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 你应该看到:
-- public | folders
-- public | libraries
-- public | predefine_properties
-- public | project_collaborators
-- ================================================

