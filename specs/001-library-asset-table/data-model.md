# Data Model: Library Asset Table View

> 本数据模型 **完全基于现有 Supabase schema**，不引入新的底层表。  
> Section / Property / Asset / 属性值 都通过下面几张表映射出来：
> - `public.libraries`
> - `public.library_field_definitions`
> - `public.library_assets`
> - `public.library_asset_values`

## Entities

### Library (`public.libraries`)

- **Fields**（见 `20251212120000_create_projects_and_libraries.sql`）：  
  - `id` (uuid, pk, default gen_random_uuid()) — Library 主键。  
  - `project_id` (uuid, fk public.projects.id) — 所属项目。  
  - `name` (text, not null) — Library 名称。  
  - `description` (text, nullable) — 描述。  
  - `created_at` (timestamptz, default now())  
  - `updated_at` (timestamptz, default now())  
  - 约束：`(project_id, name)` 唯一；`length(trim(name)) > 0`。
- **Behavior（与本 feature 相关）**：  
  - Library 展示页通过 `libraries.id` 确定当前库，展示标题/描述。  
  - 不在本 feature 中修改该表结构或约束。

### Field Definition (`public.library_field_definitions`)  
（同时承载「Section」与「Property」两个概念）

- **Fields**（见 `20251216_create_library_field_definitions_base.sql`）：  
  - `id` (uuid, pk, default gen_random_uuid()) — 字段定义标识（也是前端字段 key）。  
  - `library_id` (uuid, not null, fk public.libraries.id on delete cascade) — 所属 Library。  
  - `section` (text, not null) — 字段所属的 Section 名称；  
    - 对应 spec 中的「Section」概念，用于表头第一行分组。  
  - `label` (text, not null) — 字段展示名称；  
    - 对应 spec 中的「Property」的名称，用于表头第二行文案。  
  - `data_type` (text, not null, check in `('string','int','float','boolean','enum','date')`) — 属性值类型。  
  - `enum_options` (text[] nullable) — 当 `data_type='enum'` 时可选值列表。  
  - `required` (boolean, default false) — 是否必填。  
  - `order_index` (int, not null, default 0) — 在同一 `library_id + section` 内的排序序号。  
  - `created_at` (timestamptz, default now())。  
  - 约束：`unique(library_id, section, label)`。
- **Behavior / 映射关系**：  
  - Library 展示页以 `library_id` 过滤获取所有定义，然后：  
    - 通过 `section` 文本进行分组 → 表头第一行的分组单元（Section）。  
    - 每条记录自身视为一个字段（Property），使用 `label` 作为第二行列标题。  
  - 前端类型映射：  
    - `SectionConfig` ≈ `{ id: string; libraryId: string; name: string; orderIndex: number; }`，其中 `id` 可用 `section` 或合成 key（例如 `section` 本身），`orderIndex` 来自该 section 下字段的最小 `order_index`。  
    - `PropertyConfig` ≈ `{ id: string; sectionId: string; key: string; name: string; valueType: ...; orderIndex: number; }`，其中 `id` 与 `key` 均可直接使用 `library_field_definitions.id`，`sectionId` 则对应一个 Section 分组标识。

### Asset (`public.library_assets`)

- **Fields**（见 `20251217_add_library_assets_and_values.sql`）：  
  - `id` (uuid, pk, default gen_random_uuid()) — 资产标识。  
  - `library_id` (uuid, not null, fk public.libraries.id on delete cascade) — 所属 Library。  
  - `name` (text, not null) — 资产名称（如组件名）。  
  - `created_at` (timestamptz, default now())。
- **Behavior（与本 feature 相关）**：  
  - Library 展示页中，每一行资产行对应 `public.library_assets` 的一条记录。  
  - 页面只读这些数据，不创建/删除资产（资产的创建/编辑由其它 feature 负责）。

### Asset Value (`public.library_asset_values`)

- **Fields**（见 `20251217_add_library_assets_and_values.sql`）：  
  - `asset_id` (uuid, not null, fk public.library_assets.id on delete cascade) — 资产 ID。  
  - `field_id` (uuid, not null, fk public.library_field_definitions.id on delete cascade) — 字段定义 ID。  
  - `value_json` (jsonb, nullable) — 属性值，以 JSONB 形式存储。  
  - 复合主键：`(asset_id, field_id)`。  
  - 索引：`idx_library_asset_values_asset_id`, `idx_library_asset_values_field_id`。
- **Behavior / 映射关系**：  
  - 表示某个 Asset 在某个 Field Definition 上的单一值。  
  - Library 展示页通过 `(asset_id, field_id)` 将值聚合到 `AssetRow.propertyValues[fieldId]` 中：  
    - 例如 `propertyValues["<field_uuid>"] = parsedValue`。  
  - 若不存在某个 `(asset_id, field_id)` 记录，则视为该资产在该字段上未定义，前端显示统一占位（如「未定义」或 `—`）。

### FigmaMapping（概念实体，仅用于文档）

- **Fields（概念层面）**：  
  - `library_id` — 映射到 Figma 中哪个 Library 页或组件集合。  
  - `asset_id` — 映射到 Figma 中哪个组件/变体 node。  
  - `figma_file_key` — Figma 文件 key。  
  - `figma_node_id` — 对应 Figma 节点 id。  
  - `notes` — 说明当前实现与设计稿之间的对应规则或偏差。  
- **Behavior**：  
  - 当前不要求在数据库中存一张真正的表；  
  - 该映射通过 F2C MCP 工具（开发期）和文档来维护，用于对比 Library 展示页和 Figma 设计表格。

## Relationships

- Library 1 : N FieldDefinition  
  - `library_field_definitions.library_id` → `libraries.id`。  
  - 单个 Library 下可以有多个 Section（不同 `section` 文本）和多个 Property（同一 `section` 下多条记录）。
- Library 1 : N Asset  
  - `library_assets.library_id` → `libraries.id`。
- Asset 1 : N AssetValue  
  - `library_asset_values.asset_id` → `library_assets.id`。
- FieldDefinition 1 : N AssetValue  
  - `library_asset_values.field_id` → `library_field_definitions.id`。
- Section（概念）:  
  - 对当前 `library_id` 的所有 `library_field_definitions` 按 `section` 分组即为若干 Section；  
  - 不单独建表。

## Derived/Business Rules for Library 展示页

- **两层表头结构**：  
  - 第一行（Section）：  
    - 对当前 library 的 `library_field_definitions` 按 `section` 去重分组；  
    - 每个 Section 的列宽 `colSpan = 该 section 下字段数量`；  
    - Section 在表头中的顺序，可以按该 section 下字段的最小 `order_index` 升序排序。  
  - 第二行（Property）：  
    - 对每个 Section 内的定义按 `order_index` 升序；  
    - 使用 `label` 作为列标题，`id` 作为字段 key。

- **资产行结构 (`AssetRow`)**：  
  - 由 `library_assets` + `library_asset_values` 聚合而成：  
    - 形如：  
      - `AssetRow = { id, libraryId, name, propertyValues: Record<string, unknown> }`，  
      - 其中 `propertyValues[fieldId]` 来源于 `library_asset_values.value_json` 解析后的值。  
  - 当某个字段没有定义值（无对应 `(asset_id, field_id)` 行），界面显示统一缺省文案而非留空。

- **只读边界**：  
  - Library 展示页仅消费上述表的数据进行渲染：  
    - 不在此处创建/删除/更新 `library_field_definitions`、`library_assets` 或 `library_asset_values`；  
    - 所有 schema、RLS、写操作均由已有的 predefine 页面或其它编辑特性负责。

## Indexing & Performance Notes

- **现有索引**：  
  - `idx_library_field_definitions_library_id` 支持按 Library 查询所有字段定义。  
  - `idx_library_field_definitions_order` 支持按 `(library_id, section, order_index)` 排序。  
  - `idx_library_assets_library_id` 支持按 Library 查询资产列表。  
  - `idx_library_asset_values_asset_id`、`idx_library_asset_values_field_id` 支持按资产或字段聚合属性值。
- **本 feature 对索引的使用**：  
  - 典型查询模式：  
    - 先按 `library_id` 查询 `library_field_definitions` 与 `library_assets`；  
    - 再按这些 `asset_id` / `field_id` 查询所有相关的 `library_asset_values` 并在服务层聚合。  
  - 以当前预期规模（≤ 100 assets × ≤ 30 fields）来看，现有索引即可满足性能目标，无需新增索引；如未来数据量显著增加，再根据实际慢查询情况调整。  



