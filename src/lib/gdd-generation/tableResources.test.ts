import {
  applyInlineTableResourceReferences,
  coerceTableRowInput,
  convertMarkdownTablesToPlans,
  extractTablePlanMarker,
  materializeTableResources,
  normalizeTablePlans,
  parseTablePlanMarkerJson,
  renderTableResourceReferences,
  type GeneratedTablePlan,
} from './tableResources';

describe('GDD table resources', () => {
  it('normalizes bounded table definitions with generated row data', () => {
    expect(normalizeTablePlans([
      {
        table: ' Skills ', purpose: 'Reusable actions.', fields: [' name ', 'cost'],
        rows: [{ name: 'Basic attack', values: { name: 'Basic attack', cost: 1 } }],
      },
    ])).toEqual<GeneratedTablePlan[]>([
      {
        table: 'Skills', purpose: 'Reusable actions.', fields: ['name', 'cost'],
        rows: [{ name: 'Basic attack', values: { name: 'Basic attack', cost: 1 } }],
      },
    ]);
  });

  it('rejects duplicate table names case-insensitively', () => {
    expect(() => normalizeTablePlans([
      { table: 'Skills', purpose: 'A', fields: ['name'], rows: [{ name: 'A', values: { name: 'A' } }] },
      { table: ' skills ', purpose: 'B', fields: ['id'], rows: [{ name: 'B', values: { id: 'B' } }] },
    ])).toThrow('Duplicate generated table name');
  });

  it('promotes row value keys omitted from the declared fields', () => {
    expect(() => normalizeTablePlans([{
      table: 'Skills', purpose: 'Actions.', fields: ['name'],
      rows: [{ name: 'Basic attack', values: { cost: 1 } }],
    }])).not.toThrow();
    expect(normalizeTablePlans([{
      table: 'Skills', purpose: 'Actions.', fields: ['name'],
      rows: [{ name: 'Basic attack', values: { cost: 1 } }],
    }])[0]?.fields).toEqual(['name', 'cost']);
  });

  it('derives row name from values when the model omitted the top-level name field', () => {
    expect(normalizeTablePlans([{
      table: 'Products',
      purpose: 'Product catalog data.',
      fields: ['name', 'category', 'base_cost'],
      rows: [
        { values: { name: 'Milk', category: 'Dairy', base_cost: 10 } },
        { values: { name: 'Bread', category: 'Bakery', base_cost: 5 } },
      ],
    }])[0]?.rows.map((row) => row.name)).toEqual(['Milk', 'Bread']);
  });

  it('derives row name from the first name-like table field for localized schemas', () => {
    expect(coerceTableRowInput(
      { values: { product_name: 'Milk', category: 'Dairy' } },
      ['product_name', 'category'],
    )).toEqual({
      name: 'Milk',
      values: { product_name: 'Milk', category: 'Dairy' },
    });
  });

  it('normalizes legacy flat rows into values and drops only auxiliary ids', () => {
    expect(normalizeTablePlans([{
      table: 'Products',
      purpose: 'Product catalog data.',
      fields: ['name', 'category', 'base_cost'],
      rows: [{
        name: 'Milk',
        id: 'model-row-id',
        category: 'Dairy',
        base_cost: 10,
      }],
    }])).toEqual([{
      table: 'Products',
      purpose: 'Product catalog data.',
      fields: ['name', 'category', 'base_cost'],
      rows: [{ name: 'Milk', values: { category: 'Dairy', base_cost: 10 } }],
    }]);
  });

  it('keeps id when id is an explicitly declared table field', () => {
    expect(normalizeTablePlans([{
      table: 'Products', purpose: 'Product catalog data.', fields: ['name', 'id'],
      rows: [{ name: 'Milk', id: 'milk-1' }],
    }])[0]!.rows[0]!.values).toEqual({ id: 'milk-1' });
  });

  it('renders toolbar-style ResourceReference chips for each table row', () => {
    const plan = normalizeTablePlans([{
      table: 'Skills', purpose: 'Actions.', fields: ['name', 'cost'],
      rows: [
        { name: 'Basic', values: { name: 'Basic', cost: 1 } },
        { name: 'Heavy', values: { name: 'Heavy', cost: 2 } },
      ],
    }])[0]!;
    const [resource] = materializeTableResources('job-1', [plan]);
    const markdown = renderTableResourceReferences([resource!]);
    expect(markdown).toContain('<ResourceReference kind="table-row"');
    expect(markdown).toContain(`libraryId="${resource!.id}"`);
    expect(markdown).toContain(`assetId="${resource!.rows[0]!.id}"`);
    expect(markdown).toContain(`assetId="${resource!.rows[1]!.id}"`);
    expect(markdown).toContain(`displayFieldId="${resource!.fieldIds[0]}"`);
    expect(markdown).toContain('fallbackLabel="Basic"');
    expect(markdown).toContain('fallbackLabel="Heavy"');
    expect(markdown).toMatch(/^\u200B<ResourceReference /);
    expect(markdown).not.toMatch(/^Skills:/);
    expect(markdown).not.toContain('[Skills](');
    expect(markdown).not.toContain('## Keco Tables');
  });

  it('keeps all row chips in one inline paragraph for MDX grouping without a visible title', () => {
    const plan = normalizeTablePlans([{
      table: 'Products', purpose: 'Catalog.', fields: ['name'],
      rows: [
        { name: 'Milk', values: { name: 'Milk' } },
        { name: 'Eggs', values: { name: 'Eggs' } },
      ],
    }])[0]!;
    const [resource] = materializeTableResources('system-1', [plan]);
    const markdown = renderTableResourceReferences([resource!]);
    expect(markdown.startsWith('\u200B')).toBe(true);
    expect(markdown).not.toContain('Products:');
    expect(markdown.includes('\n')).toBe(false);
    expect(() => {
      const { validateSanctionedMdx } = require('@/lib/documents/sanctionedMdx') as typeof import('@/lib/documents/sanctionedMdx');
      const { parseSanctionedMdxAst } = require('@/lib/documents/sanctionedMdxParser') as typeof import('@/lib/documents/sanctionedMdxParser');
      validateSanctionedMdx(`# GDD\n\n${markdown}\n`);
      const root = parseSanctionedMdxAst(`# GDD\n\n${markdown}\n`);
      const paragraph = root.children?.find((child) => child.type === 'paragraph');
      expect(paragraph).toBeTruthy();
      const jsx = paragraph?.children?.filter((child) => child.type === 'mdxJsxTextElement') ?? [];
      expect(jsx).toHaveLength(2);
    }).not.toThrow();
  });

  it('does not inline internal dialogue-node rows into the GDD body', () => {
    const plan = normalizeTablePlans([{
      table: 'DialogueNodes',
      purpose: 'Derived dialogue graph nodes.',
      fields: ['nodeId', 'dialogue', 'choices'],
      rows: [{
        name: 'ch1_entry',
        values: {
          nodeId: 'ch1_entry',
          dialogue: '\u6797\u4f2f：\u4f60\u5c31\u662f\u65b0\u6765\u7684\u5e97\u4e3b？',
          choices: ['ch1_entry_choice_a', 'ch1_entry_choice_b'],
        },
      }],
    }])[0]!;
    const [resource] = materializeTableResources('system-1', [plan]);
    const markdown = applyInlineTableResourceReferences(
      '# GDD\n\n<!-- KECO_TABLE_REF DialogueNodes -->',
      [resource!],
    );

    expect(markdown).not.toContain('<ResourceReference');
    expect(markdown).not.toContain('ch1_entry');
    expect(markdown).not.toContain('KECO_TABLE_REF');
  });

  it('keeps ordinary table references while suppressing internal dialogue tables', () => {
    const resources = materializeTableResources('system-1', normalizeTablePlans([
      {
        table: 'Dialogue Events',
        purpose: 'Compiler dialogue graph.',
        fields: ['nodeId', 'dialogue'],
        rows: [{ name: 'entry', values: { nodeId: 'entry', dialogue: 'Hello.' } }],
      },
      {
        table: 'Products',
        purpose: 'Catalog.',
        fields: ['name'],
        rows: [{ name: 'Milk', values: { name: 'Milk' } }],
      },
    ]));
    const markdown = applyInlineTableResourceReferences('# GDD\nBody.', resources);

    expect(markdown).toContain('fallbackLabel="Milk"');
    expect(markdown).not.toContain('fallbackLabel="entry"');
    expect(markdown).not.toContain('Dialogue Events');
  });

  it('converts Markdown tables into Keco plans and inline references', () => {
    const result = convertMarkdownTablesToPlans([
      '# GDD',
      '',
      '## 6.2 \u751f\u6001\u533a\u7c7b\u578b',
      '',
      '| \u751f\u6001\u533a | \u7279\u5f81 | \u8d44\u6e90\u4ea7\u51fa | \u4e3b\u8981\u5a01\u80c1 |',
      '| --- | --- | --- | --- |',
      '| \u7fe0\u7eff\u5e73\u539f | \u6e29\u548c\u6c14\u5019，\u6c34\u6e90\u5145\u8db3 | \u98df\u7269 3-5 | \u72fc\u7fa4（\u4f4e\u5a01\u80c1） |',
    ].join('\n'));

    expect(result.tablePlans).toEqual([{
      table: '\u751f\u6001\u533a\u7c7b\u578b',
      purpose: 'Imported from a Markdown table in the generated GDD.',
      fields: ['\u751f\u6001\u533a', '\u7279\u5f81', '\u8d44\u6e90\u4ea7\u51fa', '\u4e3b\u8981\u5a01\u80c1'],
      rows: [{
        name: '\u7fe0\u7eff\u5e73\u539f',
        values: {
          \u751f\u6001\u533a: '\u7fe0\u7eff\u5e73\u539f',
          \u7279\u5f81: '\u6e29\u548c\u6c14\u5019，\u6c34\u6e90\u5145\u8db3',
          \u8d44\u6e90\u4ea7\u51fa: '\u98df\u7269 3-5',
          \u4e3b\u8981\u5a01\u80c1: '\u72fc\u7fa4（\u4f4e\u5a01\u80c1）',
        },
      }],
    }]);
    expect(result.markdown).toContain('<!-- KECO_TABLE_REF \u751f\u6001\u533a\u7c7b\u578b -->');
    expect(result.markdown).not.toContain('| \u751f\u6001\u533a |');
  });

  it('strips a redundant table title line before KECO_TABLE_REF markers', () => {
    const resources = materializeTableResources('system-1', normalizeTablePlans([{
      table: 'Products', purpose: 'Catalog.', fields: ['name'],
      rows: [{ name: 'Milk', values: { name: 'Milk' } }],
    }]));
    const markdown = applyInlineTableResourceReferences(
      '# GDD\n\nIntro.\n\nProducts:\n<!-- KECO_TABLE_REF Products -->\n\nBody.',
      resources,
    );
    expect(markdown).not.toContain('Products:');
    expect(markdown).toContain('Intro.');
    expect(markdown).toContain('Body.');
    expect(markdown).toContain('<ResourceReference kind="table-row"');
  });

  it('assigns deterministic table, row, and field IDs from the series seed', () => {
    const plans = normalizeTablePlans([{
      table: 'Skills', purpose: 'Actions.', fields: ['name', 'cost'],
      rows: [{ name: 'Basic', values: { name: 'Basic', cost: 1 } }],
    }]);
    expect(materializeTableResources('system-1', plans)).toEqual(materializeTableResources('system-1', plans));
    const first = materializeTableResources('system-1', plans)[0]!;
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.fieldIds).toHaveLength(2);
    expect(first.fieldIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.fieldIds[0]).not.toBe(first.fieldIds[1]);
    expect(first.id).not.toBe(materializeTableResources('system-2', plans)[0]!.id);
  });

  it('reuses an existing series library ID so ResourceReferences stay resolvable', () => {
    const plans = normalizeTablePlans([{
      table: 'CustomerTypes', purpose: 'Customers.', fields: ['name'],
      rows: [{ name: 'Tourist', values: { name: 'Tourist' } }],
    }]);
    const stableId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const first = materializeTableResources('system-1', plans, new Map([['customertypes', stableId]]))[0]!;
    const second = materializeTableResources('system-1', plans, new Map([['customertypes', stableId]]))[0]!;
    expect(first.id).toBe(stableId);
    expect(second.id).toBe(stableId);
    expect(first.rows[0]!.id).toBe(second.rows[0]!.id);
    expect(first.fieldIds[0]).toBe(second.fieldIds[0]);
  });

  it('replaces inline KECO_TABLE_REF markers with ResourceReference groups', () => {
    const plans = normalizeTablePlans([{
      table: 'Skills', purpose: 'Actions.', fields: ['name'],
      rows: [{ name: 'Basic', values: { name: 'Basic' } }],
    }]);
    const resources = materializeTableResources('system-1', plans);
    const markdown = applyInlineTableResourceReferences(
      '# GDD\n\n## Skills\n<!-- KECO_TABLE_REF Skills -->\n\nBody.',
      resources,
    );
    expect(markdown).toContain(`libraryId="${resources[0]!.id}"`);
    expect(markdown).toContain('fallbackLabel="Basic"');
    expect(markdown).not.toContain('KECO_TABLE_REF');
  });

  it('strips orphan KECO_TABLE_REF markers when no table resources were generated', () => {
    const markdown = applyInlineTableResourceReferences(
      '# GDD\n\nProducts:\n<!-- KECO_TABLE_REF Products -->\n\nBody.',
      [],
    );
    expect(markdown).not.toContain('KECO_TABLE_REF');
    expect(markdown).not.toContain('Products:');
    expect(markdown).toContain('Body.');
  });

  it('appends missing table references and drops unknown or duplicate markers', () => {
    const resources = materializeTableResources('system-1', normalizeTablePlans([{
      table: 'Skills', purpose: 'Actions.', fields: ['name'],
      rows: [{ name: 'Basic', values: { name: 'Basic' } }],
    }]));
    const appended = applyInlineTableResourceReferences('# GDD\nBody.', resources);
    expect(appended).toContain('## Keco Tables');
    expect(appended).toContain(`libraryId="${resources[0]!.id}"`);

    const unknown = applyInlineTableResourceReferences(
      '# GDD\n<!-- KECO_TABLE_REF Missing -->\n',
      resources,
    );
    expect(unknown).not.toContain('KECO_TABLE_REF');
    expect(unknown).toContain(`libraryId="${resources[0]!.id}"`);

    const duplicate = applyInlineTableResourceReferences(
      '# GDD\n<!-- KECO_TABLE_REF Skills -->\n<!-- KECO_TABLE_REF Skills -->\n',
      resources,
    );
    expect(duplicate.match(/libraryId=/g)).toHaveLength(1);
  });

  it('extracts a valid table marker and removes it from the GDD body', () => {
    const plan = { table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] };
    const result = extractTablePlanMarker(`# GDD\n<!-- KECO_TABLE_PLAN ${JSON.stringify([plan])} -->`);
    expect(result.markdown).toBe('# GDD');
    expect(result.tablePlans).toEqual([{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }]);
    expect(result.warning).toBeNull();
  });

  it('merges multiple valid table markers in encounter order', () => {
    const skills = { table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] };
    const items = { table: 'Items', purpose: 'Inventory.', fields: ['name'], rows: [{ name: 'Potion', values: { name: 'Potion' } }] };
    const result = extractTablePlanMarker([
      '# GDD',
      `<!-- KECO_TABLE_PLAN ${JSON.stringify([skills])} -->`,
      '## Content',
      `<!-- KECO_TABLE_PLAN ${JSON.stringify([items])} -->`,
      'Body.',
    ].join('\n'));

    expect(result.markdown).toBe('# GDD\n\n## Content\n\nBody.');
    expect(result.tablePlans.map((plan) => plan.table)).toEqual(['Skills', 'Items']);
    expect(result.warning).toBeNull();
  });

  it('repairs trailing commas and smart quotes in table marker JSON', () => {
    const parsed = parseTablePlanMarkerJson('[{"table":"Skills","purpose":"Actions.","fields":["name",],"rows":[{"name":"Basic","values":{"name":"Basic"},},],},]');
    expect(parsed).toEqual([{
      table: 'Skills',
      purpose: 'Actions.',
      fields: ['name'],
      rows: [{ name: 'Basic', values: { name: 'Basic' } }],
    }]);
  });

  it('returns a bounded warning and no plans for malformed whole marker JSON', () => {
    const result = extractTablePlanMarker('Body\n<!-- KECO_TABLE_PLAN [{bad json] -->\n');
    expect(result.markdown).toBe('Body');
    expect(result.tablePlans).toEqual([]);
    expect(result.warning).toMatch(/not valid JSON/i);
    expect(result.warning?.length).toBeLessThanOrEqual(300);
  });

  it('returns a bounded warning and no plans for schema-invalid table entries', () => {
    const result = extractTablePlanMarker('Body\n<!-- KECO_TABLE_PLAN [{"table":"Skills"}] -->\n');
    expect(result.tablePlans).toEqual([]);
    expect(result.warning).toBeTruthy();
    expect(result.warning?.length).toBeLessThanOrEqual(300);
  });
});
