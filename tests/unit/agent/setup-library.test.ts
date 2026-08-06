import { setupLibrary } from '@/lib/agent/workflows/setup-library';

describe('setup_library flat field contract', () => {
  it('does not advertise section grouping', () => {
    const fields = (setupLibrary.parameters.properties as Record<string, any>).fields;
    expect(fields.items.properties).not.toHaveProperty('section');
    expect(setupLibrary.description).not.toMatch(/\bsections?\b|\btabs?\b/i);
  });
});
