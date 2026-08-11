import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/agent/ChatInput.tsx'),
  'utf8'
);

describe('chat document attachment source wiring', () => {
  it('checks attachment text for emptiness without trimming the submitted source', () => {
    expect(source).toContain('if (!text.trim())');
    expect(source).toMatch(/buildDesignMessage\(\{[\s\S]*documentText:\s*text,/);
    expect(source).not.toContain('const documentText = text.trim()');
  });
});
