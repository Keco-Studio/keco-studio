# Happy Path E2E Test Documentation

## Overview

This document describes the Happy Path E2E test implementation for the KECO Studio project management system. The test validates the complete user journey from project creation through asset management.

## Architecture

### Design Principles

1. **Page Object Model (POM)**: All UI interactions are encapsulated in Page Objects
2. **Semantic Selectors**: Uses accessible selectors (getByRole, getByLabel, getByText) - NO CSS selectors
3. **Fixture-Based Data**: All test data comes from reusable fixtures
4. **Business-Focused Specs**: Test specs contain only business logic, no low-level UI details
5. **Production-Grade Quality**: Deterministic, readable, and maintainable

### Project Structure

```
tests/e2e/
├── specs/
│   └── happy-path.spec.ts          # Main test spec (business flow only)
├── pages/
│   ├── project.page.ts             # Project management page object
│   ├── library.page.ts             # Library & folder management page object
│   ├── predefined.page.ts          # Predefined template page object
│   └── asset.page.ts               # Asset management page object
└── fixures/
    ├── projects.ts                 # Project test data
    ├── folders.ts                  # Folder test data
    ├── libraries.ts                # Library test data
    ├── predefined.ts               # Predefined template test data
    └── assets.ts                   # Asset test data
```

## Business Flow

The Happy Path test validates this complete workflow:

### 1. Project Creation
- Create a new project (家畜管理项目)
- System automatically creates a default "Resource Folder"

### 2. Library Setup
Tests two library creation patterns:
- **P → F → L**: Libraries inside the Resource Folder
  - Create reference library (品种库) for referencing
  - Create main library (牲畜库) for assets
- **P → L**: Library directly under project (直接库)

### 3. Predefined Template
Create a template with multiple field types:
- **Name field**: Auto-generated (string, non-configurable)
- **String field**: 成熟时间 (maturity time)
- **Option field**: 健康状况 (health status) with options:
  - 健康 (healthy)
  - 生病 (sick)
  - 需要检查 (needs checkup)
- **Reference field**: 品种 (breed) → references 品种库

### 4. Asset Creation
- Create asset (黑山羊001) based on the template
- Fill all fields including:
  - Name
  - String value
  - Option selection
  - Reference selection

### 5. Verification
- Verify asset created successfully
- Verify all field values are correct

## Page Objects

### ProjectPage
**Responsibilities:**
- Navigate to projects page
- Create new projects
- Open existing projects
- Verify project existence

**Key Methods:**
```typescript
createProject(project: ProjectData): Promise<void>
openProject(projectName: string): Promise<void>
expectProjectExists(projectName: string): Promise<void>
```

### LibraryPage
**Responsibilities:**
- Folder navigation (including default Resource Folder)
- Folder creation
- Library creation (both in folders and directly under project)
- Library navigation

**Key Methods:**
```typescript
openFolder(folderName: string): Promise<void>
createFolder(folder: FolderData): Promise<void>
createLibrary(library: LibraryData): Promise<void>
openLibrary(libraryName: string): Promise<void>
```

### PredefinedPage
**Responsibilities:**
- Predefined template creation
- Section management
- Field item configuration
- Special field type configuration (option, reference)

**Key Methods:**
```typescript
createPredefinedTemplate(template: PredefinedTemplateData): Promise<void>
addSection(sectionName: string): Promise<void>
addField(field: FieldItemData): Promise<void>
configureOptionField(options: string[]): Promise<void>
configureReferenceField(libraryName: string): Promise<void>
```

### AssetPage
**Responsibilities:**
- Asset creation from templates
- Template selection
- Dynamic form filling
- Asset verification

**Key Methods:**
```typescript
createAsset(templateName: string, asset: AssetData): Promise<void>
selectTemplate(templateName: string): Promise<void>
fillField(fieldLabel: string, value: string | string[]): Promise<void>
expectAssetName(assetName: string): Promise<void>
expectFieldValue(fieldLabel: string, expectedValue: string): Promise<void>
```

## Fixtures

### Projects Fixture (`projects.ts`)
```typescript
export const projects = {
  happyPath: {
    name: '家畜管理项目',
    description: '用于端到端测试的家畜资产管理项目',
  }
};
```

### Folders Fixture (`folders.ts`)
```typescript
export const DEFAULT_RESOURCE_FOLDER = 'Resource Folder';
```

### Libraries Fixture (`libraries.ts`)
```typescript
export const libraries = {
  livestock: { name: '牲畜库', ... },  // Main library
  breed: { name: '品种库', ... },      // Reference library
  directLibrary: { name: '直接库', ... } // Direct under project
};
```

### Predefined Templates Fixture (`predefined.ts`)
```typescript
export const predefinedTemplates = {
  livestock: {
    name: '牲畜模板',
    sections: [{
      name: '基本信息',
      fields: [
        { label: '成熟时间', datatype: 'string' },
        { label: '健康状况', datatype: 'option', options: [...] },
        { label: '品种', datatype: 'reference', referenceLibrary: '品种库' }
      ]
    }]
  }
};
```

### Assets Fixture (`assets.ts`)
```typescript
export const assets = {
  livestock: {
    name: '黑山羊001',
    fields: [
      { label: '成熟时间', value: '2024年6月' },
      { label: '健康状况', value: '健康' },
      { label: '品种', value: '黑山羊品种' }
    ]
  }
};
```

## Selector Strategy

### Why Semantic Selectors?

1. **Accessibility-First**: Using getByRole, getByLabel, getByText ensures the UI is accessible
2. **Resilient**: Less brittle than CSS selectors or test IDs
3. **Self-Documenting**: Code reads like user interactions
4. **Framework-Aligned**: Follows Playwright best practices

### Selector Priority (from highest to lowest)

1. **getByRole**: Targets elements by ARIA role
   ```typescript
   page.getByRole('button', { name: /create project/i })
   ```

2. **getByLabel**: Targets form inputs by their labels
   ```typescript
   page.getByLabel(/project name/i)
   ```

3. **getByText**: Targets elements by visible text
   ```typescript
   page.getByText(projectName, { exact: true })
   ```

4. **locator** (as fallback): Only when semantic selectors aren't available
   ```typescript
   page.locator('[role="alert"]').filter({ hasText: /success/i })
   ```

### Case-Insensitive Patterns

Using regex with `/i` flag for internationalization support:
```typescript
// Supports both English and Chinese
page.getByRole('heading', { name: /projects|项目/i })
page.getByLabel(/description|描述/i)
```

## Running the Tests

### Prerequisites

1. Ensure the dev server is running:
   ```bash
   npm run dev
   ```

2. User authentication is configured (storageState)

### Execute Happy Path Test

```bash
# Run all happy path tests
npx playwright test tests/e2e/specs/happy-path.spec.ts

# Run with UI mode
npx playwright test tests/e2e/specs/happy-path.spec.ts --ui

# Run with headed browser
npx playwright test tests/e2e/specs/happy-path.spec.ts --headed

# Debug mode
npx playwright test tests/e2e/specs/happy-path.spec.ts --debug
```

### View Test Report

```bash
npx playwright show-report
```

## Test Data Management

### Unique Data Generation

All fixtures provide helper functions to generate unique data:

```typescript
import { generateProjectData } from '../fixures/projects';
import { generateLibraryData } from '../fixures/libraries';

// Generates unique project with timestamp
const project = generateProjectData();
```

### Predefined Data

Use predefined fixtures for consistency:

```typescript
import { projects } from '../fixures/projects';
import { libraries } from '../fixures/libraries';

// Use predefined happy path data
await projectPage.createProject(projects.happyPath);
await libraryPage.createLibrary(libraries.livestock);
```

## Business Domain Rules

### Project Hierarchy

```
Project
├── Folder (Resource Folder - auto-created)
│   └── Library
└── Library (direct)
```

### Template Field Rules

1. **First Field**: Always "Name" (string, non-configurable)
2. **Option Fields**: Require ≥2 configured options
3. **Reference Fields**: Must reference an existing library

### Datatype Coverage (Happy Path)

Out of 7 total datatypes, Happy Path covers:
- ✅ string
- ✅ option
- ✅ reference
- ❌ number (out of scope)
- ❌ boolean (out of scope)
- ❌ date (out of scope)
- ❌ media (out of scope)

## Debugging Tips

### Visual Debugging

```bash
# Enable slow-mo in playwright.config.ts
launchOptions: {
  slowMo: 1000  // Slow down by 1 second per step
}
```

### Trace Viewer

Traces are enabled by default. View them after test run:

```bash
npx playwright show-trace trace.zip
```

### Screenshot on Failure

Automatically captured. Check `test-results/` folder.

### Step-by-Step Debugging

Use VS Code Playwright extension or:

```typescript
await page.pause();  // Pause execution
```

## Maintenance Guidelines

### Adding New Fields to Template

1. Add field to `predefined.ts` fixture
2. Add corresponding value to `assets.ts` fixture
3. No changes needed to Page Objects (dynamic handling)

### Adding New Datatype Support

1. Update `FieldItemData` type in `predefined.ts`
2. Extend `PredefinedPage.addField()` to handle new type
3. Extend `AssetPage.fillField()` for form filling

### Localization Support

Add alternative language patterns to selectors:

```typescript
// English | Chinese
page.getByRole('button', { name: /create|创建/i })
page.getByLabel(/name|名称/i)
```

## Known Limitations

1. **MCP Not Used**: Browser installation requires sudo in WSL environment
2. **Dynamic Forms**: Asset form structure depends on template configuration
3. **Navigation Assumptions**: Assumes standard navigation patterns (back buttons, breadcrumbs)

## Future Enhancements

1. **Add storageState setup** for authenticated sessions
2. **Implement data cleanup** hooks (afterEach)
3. **Add negative test cases** (validation errors, edge cases)
4. **Expand datatype coverage** (all 7 types)
5. **Multi-language test suite** (English + Chinese)
6. **Performance benchmarks** (asset creation time)

## Contact & Support

For questions or issues with the Happy Path test suite:
- Review this documentation
- Check Page Object implementations
- Examine fixture data structures
- Run with `--debug` flag for step-by-step inspection

---

**Last Updated**: December 24, 2025  
**Test Framework**: Playwright + TypeScript  
**Architecture**: Page Object Model  
**Selector Strategy**: Semantic (getByRole, getByLabel, getByText)

