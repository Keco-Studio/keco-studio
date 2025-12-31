-- 禁用所有表的 RLS，因为我们已经在代码层面实现了完整的权限验证
-- 根据老板要求，不依赖 Supabase 的 RLS，而是在应用层实现安全策略

-- 禁用 projects 表的 RLS
alter table public.projects disable row level security;

-- 禁用 libraries 表的 RLS
alter table public.libraries disable row level security;

-- 禁用 folders 表的 RLS
alter table public.folders disable row level security;

-- 禁用 library_assets 表的 RLS
alter table public.library_assets disable row level security;

-- 禁用 library_asset_values 表的 RLS
alter table public.library_asset_values disable row level security;

-- 禁用 library_field_definitions 表的 RLS
alter table public.library_field_definitions disable row level security;

-- 注意：以下表保留 RLS，因为它们需要特殊的访问控制
-- 1. profiles - 用户只能访问自己的资料
-- 2. shared_documents - 协作文档需要 RLS
-- 3. predefine_properties - 用户只能访问自己的预定义属性

-- 如果需要，也可以禁用这些表的 RLS，并在代码层实现权限验证：
-- alter table public.profiles disable row level security;
-- alter table public.shared_documents disable row level security;
-- alter table public.predefine_properties disable row level security;

