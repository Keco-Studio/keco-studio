import {
  materializeTableResources,
  normalizeTablePlans,
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

  it('normalizes legacy flat rows into values and drops only auxiliary ids', () => {
    expect(normalizeTablePlans([{
      table: 'Products',
      purpose: '商品数据。',
      fields: ['name', 'category', 'base_cost'],
      rows: [{
        name: 'Milk',
        id: 'model-row-id',
        category: 'Dairy',
        base_cost: 10,
      }],
    }])).toEqual([{
      table: 'Products',
      purpose: '商品数据。',
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
});
