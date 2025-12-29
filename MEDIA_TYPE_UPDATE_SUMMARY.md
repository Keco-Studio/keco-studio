# Media Type Update Summary

## Overview
Successfully split the `media` data type into `image` and `file` types, and updated the UI to match the Figma design specifications.

## Changes Made

### 1. Type Definitions Updated
- **src/app/(dashboard)/[projectId]/[libraryId]/predefine/types.ts**
  - Changed `FieldType` from `'media'` to `'image' | 'file'`

- **src/app/(dashboard)/[projectId]/[libraryId]/predefine/utils.ts**
  - Updated `getFieldTypeIcon()` to handle `image` and `file` types separately
  - Added import for `predefineTypeFileIcon`
  - Updated `FIELD_TYPE_OPTIONS` to show "Image" and "File" instead of "Media/File"

- **src/lib/services/libraryAssetsService.ts**
  - Updated `FieldDefinitionRow` type to use `'image' | 'file'` instead of `'media'`

- **src/lib/types/libraryAssets.ts**
  - Updated `PropertyConfig` dataType to include `'image' | 'file'` instead of `'media'`

- **src/app/(dashboard)/[projectId]/[libraryId]/predefine/validation.ts**
  - Updated Zod schema to validate `'image' | 'file'` instead of `'media'`

### 2. Component Updates

#### MediaFileUpload Component
- **src/components/media/MediaFileUpload.tsx**
  - Added `fieldType` prop to distinguish between image and file uploads
  - Updated upload button design:
    - Shows cloud upload icon from `assetFileUploadIcon.svg`
    - Displays "upload image" or "upload file" text based on field type
    - New styling with dashed border
  - Updated uploaded file display:
    - Horizontal layout with icon/thumbnail + filename + "replace" button
    - Different icons for image vs file types
    - Replace button instead of View/Delete buttons
  - Added `handleReplace()` function for replacing files
  - Different accept types based on field type (image/* for images, document types for files)

- **src/components/media/MediaFileUpload.module.css**
  - Updated `.uploadButton` styling:
    - Flex layout with gap for icon and text
    - Light gray background with dashed border
    - Centered alignment
  - Added `.uploadedFileContainer` for horizontal layout
  - Added `.fileIconWrapper` for file icon display
  - Updated `.imageThumbnail` to 40x40px size
  - Added `.uploadedFileName` for file name display
  - Added `.replaceButton` with purple hover state
  - Removed old file info and action button styles

### 3. Page Component Updates
- **src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx**
  - Updated `FieldDef` type to use `'image' | 'file'` instead of `'media'`
  - Updated `DATA_TYPE_LABEL` to include separate labels for Image and File
  - Updated field rendering logic to check for `'image' || 'file'` instead of `'media'`
  - Passed `fieldType` prop to `MediaFileUpload` component
  - Updated value handling in save operations to support both types

### 4. Table Component Updates
- **src/components/libraries/LibraryAssetsTable.tsx**
  - Updated media type checks to `'image' || 'file'` instead of `'media'`
  - Passed `fieldType` prop to `MediaFileUpload` in edit mode
  - Maintained backward compatibility for displaying uploaded files

### 5. Database Migration
- **supabase/migrations/20251229000000_update_media_to_image_file_types.sql**
  - Created new migration to update data type constraint
  - Drops old constraint that included 'media'
  - Adds new constraint with 'image' and 'file'
  - Migrates existing 'media' fields to 'image' type (can be adjusted as needed)

## Design Changes Implemented

Based on the Figma design at node-id=1764-19579:

1. **Upload Button (Empty State)**
   - Cloud upload icon on the left
   - Text "upload file" or "upload image" based on type
   - Light gray background (#F5F5F7)
   - Dashed border (#D1D1D6)
   - Full width layout

2. **Uploaded State (File)**
   - File icon (24x24) from `assetFileIcon.svg`
   - File name in the middle
   - "replace" button on the right in purple (#8726EE)
   - Horizontal flex layout
   - Light gray background with solid border

3. **Uploaded State (Image)**
   - Image thumbnail (40x40) with rounded corners
   - Image name in the middle
   - "replace" button on the right in purple
   - Same layout as file but with thumbnail instead of icon

## Icons Used
- `assetFileUploadIcon.svg` - Cloud upload icon for upload button
- `assetFileIcon.svg` - Generic file icon for uploaded files
- `predefineTypeFileIcon.svg` - Icon for File data type in field definitions

## Backward Compatibility
- Existing media file data will continue to work
- Database migration converts existing 'media' type fields to 'image'
- Can be adjusted if different migration logic is needed

## Testing Recommendations
1. Test creating new Image type fields
2. Test creating new File type fields
3. Test uploading images to Image fields
4. Test uploading documents to File fields
5. Test the replace functionality
6. Verify existing media data displays correctly
7. Run database migration on development environment first

## Notes
- The storage structure remains unchanged - only the UI and type definitions were updated
- The `MediaFileMetadata` type and storage service remain compatible
- All linter checks pass with no errors

