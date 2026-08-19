import {
  coerceTableRowInput,
  extractTablePlanMarker,
  materializeTableResources,
  normalizeTablePlans,
  parseTablePlanMarkerJson,
  renderTableReferences,
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
      { values: { 商品名: '牛奶', category: 'Dairy' } },
      ['商品名', 'category'],
    )).toEqual({
      name: '牛奶',
      values: { 商品名: '牛奶', category: 'Dairy' },
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
      table: 'Products', purpose: '商品数据。', fields: ['name', 'id'],
      rows: [{ name: 'Milk', id: 'milk-1' }],
    }])[0]!.rows[0]!.values).toEqual({ id: 'milk-1' });
  });

  it('renders stable table resource references and never embeds rows', () => {
    const plan = normalizeTablePlans([{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }])[0]!;
    const markdown = renderTableReferences('project-1', [
      { id: 'table-1', table: plan.table, purpose: plan.purpose, fields: plan.fields, rows: plan.rows },
    ]);
    expect(markdown).toContain('[Skills](/project-1/table-1)');
    expect(markdown).toContain('Actions.');
    expect(markdown).toContain('Fields: name');
    expect(markdown).not.toContain('rows');
  });

  it('assigns deterministic resource IDs from the generation job', () => {
    const plans = normalizeTablePlans([{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }]);
    expect(materializeTableResources('job-1', plans)).toEqual(materializeTableResources('job-1', plans));
    expect(materializeTableResources('job-1', plans)[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(materializeTableResources('job-1', plans)[0].id).not.toBe(materializeTableResources('job-2', plans)[0].id);
  });

  it('extracts a valid table marker and removes it from the GDD body', () => {
    const plan = { table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] };
    const result = extractTablePlanMarker(`# GDD\n<!-- KECO_TABLE_PLAN ${JSON.stringify([plan])} -->`);
    expect(result.markdown).toBe('# GDD');
    expect(result.tablePlans).toEqual([{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }]);
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
