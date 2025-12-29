# Migration Guide: Media Type Split to Image/File

## 问题说明
如果您遇到错误：
```
Invalid enum value. Expected 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date' | 'image' | 'file' | 'reference', received 'media'
```

这是因为数据库中仍有旧的 `media` 类型字段定义，需要运行数据库迁移。

## 解决方案

### 方案 1：运行数据库迁移（推荐）

1. **使用 Supabase CLI 运行迁移**
   ```bash
   # 确保您在项目根目录
   cd /home/a1136/Workspace/keco-studio
   
   # 运行迁移
   npx supabase db push
   ```

2. **或者手动在 Supabase Dashboard 运行 SQL**
   - 登录 Supabase Dashboard
   - 进入 SQL Editor
   - 运行以下 SQL：

   ```sql
   -- 删除旧约束
   ALTER TABLE public.library_field_definitions
     DROP CONSTRAINT IF EXISTS library_field_definitions_data_type_check;

   -- 添加新约束（包含 image 和 file 类型）
   ALTER TABLE public.library_field_definitions
     ADD CONSTRAINT library_field_definitions_data_type_check
     CHECK (data_type IN ('string','int','float','boolean','enum','date','image','file','reference'));

   -- 将现有的 'media' 类型迁移为 'image'
   UPDATE public.library_field_definitions
     SET data_type = 'image'
     WHERE data_type = 'media';
   ```

### 方案 2：临时兼容方案（已自动应用）

代码中已经添加了自动转换逻辑，会在加载数据时将旧的 `media` 类型自动转换为 `image`。

但是，**您仍然需要运行数据库迁移**以完全解决问题，否则：
- 保存字段时仍可能遇到问题
- 其他直接查询数据库的地方可能出错

## 迁移后的变化

### 原有的 media 类型字段
- 自动转换为 `image` 类型
- 数据和功能保持不变

### 如何创建不同类型的字段
- **Image 类型**：用于上传和显示图片（jpg, png, gif等）
- **File 类型**：用于上传文档（pdf, doc, xls等）

## 验证迁移成功

运行迁移后，请验证：

1. ✅ 可以正常保存现有字段
2. ✅ 可以创建新的 Image 类型字段
3. ✅ 可以创建新的 File 类型字段
4. ✅ 上传功能正常工作

## 回滚方案

如果需要回滚到旧版本：

```sql
-- 删除新约束
ALTER TABLE public.library_field_definitions
  DROP CONSTRAINT IF EXISTS library_field_definitions_data_type_check;

-- 恢复旧约束
ALTER TABLE public.library_field_definitions
  ADD CONSTRAINT library_field_definitions_data_type_check
  CHECK (data_type IN ('string','int','float','boolean','enum','date','media','reference'));

-- 将 image 和 file 转回 media
UPDATE public.library_field_definitions
  SET data_type = 'media'
  WHERE data_type IN ('image', 'file');
```

## 需要帮助？

如果遇到问题，请检查：
1. Supabase 连接是否正常
2. 数据库权限是否充足
3. 是否有其他正在运行的迁移

## 迁移文件位置
`supabase/migrations/20251229000000_update_media_to_image_file_types.sql`

