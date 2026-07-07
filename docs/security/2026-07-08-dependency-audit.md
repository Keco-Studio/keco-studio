# Dependency Audit Notes - 2026-07-08

## Batch 3 Changes

- Upgraded React and React DOM to `19.2.7`, which satisfies the installed `@ant-design/v5-patch-for-react-19` peer requirement.
- Upgraded Next to `16.2.10`.
- Removed vulnerable `xlsx` and replaced app import/export code with `exceljs` helpers.
- Removed unused `node-fetch`.
- Removed stale `@types/echarts`; ECharts ships its own types.
- Moved `ngrok` out of production dependencies and into devDependencies.
- Upgraded direct dependencies with fix releases available in this pass:
  - `axios` to `1.18.1`
  - `nodemailer` to `9.0.3`
  - `resend` to `6.17.1`
  - `echarts` to `6.1.0`
  - `mathjs` to `15.2.0`

## Verification

Commands run:

```bash
npm run test:unit -- tests/unit/dependency-risk.test.ts tests/unit/workbook-utils.test.ts --runInBand
npm ls react react-dom next echarts mathjs --depth=0
npm run typecheck
npm audit --omit=dev --registry=https://registry.npmjs.org --json
```

The production audit count dropped from 34 to 27 advisories.

## Remaining Audit Items

Remaining advisories after this batch are not hidden:

- `next` reports through its bundled `postcss` range. The audit feed suggests an invalid downgrade path, so this remains for the next safe Next release or an upstream audit correction.
- `exceljs@4.4.0` reports `uuid@8.3.2`; npm suggests downgrading ExcelJS to `3.4.0`, which is not a safe security upgrade path.

These should be revisited after upstream package releases or by replacing the affected direct packages in a dedicated follow-up.

## Follow-up Reduction

- Moved `@types/nodemailer` to devDependencies so its `@aws-sdk/*` and `fast-xml-parser` chain no longer appears in the production audit.
- Refreshed safe transitive patch versions for `form-data`, `ws`, `minimatch`, and `brace-expansion`.
- Production audit now reports 4 remaining moderate advisories, limited to the `next`/`postcss` and `exceljs`/`uuid` upstream paths above.
