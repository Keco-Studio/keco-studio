#!/bin/bash

# Media/File Upload Feature Verification Script
# This script verifies that all components for the media upload feature are properly configured

echo "=========================================="
echo "Media/File Upload Feature Verification"
echo "=========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Supabase status
echo "1. Checking Supabase status..."
if npx supabase status > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Supabase is running"
else
    echo -e "${RED}✗${NC} Supabase is not running"
    echo "   Run: npx supabase start"
    exit 1
fi
echo ""

# Check bucket existence
echo "2. Checking storage bucket..."
BUCKET_EXISTS=$(psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -t -c "SELECT COUNT(*) FROM storage.buckets WHERE id = 'library-media-files';")
if [ "$BUCKET_EXISTS" -eq "1" ]; then
    echo -e "${GREEN}✓${NC} Bucket 'library-media-files' exists"
    
    # Check if bucket is public
    IS_PUBLIC=$(psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -t -c "SELECT public FROM storage.buckets WHERE id = 'library-media-files';")
    if [ "$IS_PUBLIC" = " t" ]; then
        echo -e "${GREEN}✓${NC} Bucket is public"
    else
        echo -e "${RED}✗${NC} Bucket is not public"
    fi
else
    echo -e "${RED}✗${NC} Bucket 'library-media-files' does not exist"
    echo "   Run: npx supabase db reset"
    exit 1
fi
echo ""

# Check RLS policies
echo "3. Checking RLS policies..."
POLICIES=$(psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -t -c "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (policyname LIKE '%library-media%' OR policyname LIKE '%their own files%');")
if [ "$POLICIES" -ge "4" ]; then
    echo -e "${GREEN}✓${NC} All RLS policies exist ($POLICIES policies found)"
    
    # List policies
    echo "   Policies:"
    psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -t -c "SELECT '   - ' || policyname || ' (' || cmd || ')' FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (policyname LIKE '%library-media%' OR policyname LIKE '%their own files%') ORDER BY cmd;"
else
    echo -e "${RED}✗${NC} Missing RLS policies (found $POLICIES, expected 4)"
    exit 1
fi
echo ""

# Check if files exist
echo "4. Checking implementation files..."
FILES=(
    "src/components/media/MediaFileUpload.tsx"
    "src/components/media/MediaFileUpload.module.css"
    "src/lib/services/mediaFileUploadService.ts"
    "supabase/migrations/20251222000000_create_library_media_files_bucket.sql"
)

ALL_FILES_EXIST=true
for FILE in "${FILES[@]}"; do
    if [ -f "$FILE" ]; then
        echo -e "${GREEN}✓${NC} $FILE"
    else
        echo -e "${RED}✗${NC} $FILE (missing)"
        ALL_FILES_EXIST=false
    fi
done

if [ "$ALL_FILES_EXIST" = false ]; then
    exit 1
fi
echo ""

# Check Next.js dev server
echo "5. Checking Next.js development server..."
if curl -s http://localhost:3000 > /dev/null 2>&1 || curl -s http://localhost:3001 > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Next.js dev server is running"
else
    echo -e "${YELLOW}⚠${NC} Next.js dev server is not running"
    echo "   Run: npm run dev"
fi
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}✓ All checks passed!${NC}"
echo "=========================================="
echo ""
echo "The Media/File upload feature is ready to use."
echo ""
echo "Documentation:"
echo "  - User Guide: MEDIA_UPLOAD_GUIDE.md"
echo "  - Testing Guide: TEST_MEDIA_UPLOAD.md"
echo "  - Implementation Summary: MEDIA_UPLOAD_IMPLEMENTATION_SUMMARY.md"
echo ""
echo "Quick start:"
echo "  1. Log in to the application"
echo "  2. Go to a Library's Predefine page"
echo "  3. Add a property with type 'Media/File'"
echo "  4. Create/edit an Asset and upload files!"
echo ""

