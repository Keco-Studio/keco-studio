import { readFile } from 'node:fs/promises';

const CREDENTIAL_PATTERNS = [
  /sb_secret_[A-Za-z0-9_-]+/g,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /(?:access|refresh|registration_access|id)_token["']?\s*[=:]\s*["']?(?!\[REDACTED\])[A-Za-z0-9._-]{12,}/gi,
  /(?:client|codec|cursor|service_role)_secret["']?\s*[=:]\s*["']?(?!\[REDACTED\])[A-Za-z0-9._-]{12,}/gi,
  /(?:authorization_code|code_verifier|pkce_verifier)["']?\s*[=:]\s*["']?[A-Za-z0-9._~-]{12,}/gi,
];
const PLACEHOLDERS = /\b(?:TODO|TBD|PLACEHOLDER|NOT_RUN|PENDING)\b/g;

export function scanMcpEvidenceText(text: string, options: { allowPlaceholders?: boolean } = {}) {
  const credentialMatches = CREDENTIAL_PATTERNS.flatMap(pattern => [...text.matchAll(pattern)]
    .map(match => ({ index: match.index ?? -1, pattern: pattern.source })));
  const placeholderMatches = options.allowPlaceholders ? [] : [...text.matchAll(PLACEHOLDERS)]
    .map(match => ({ index: match.index ?? -1, value: match[0] }));
  return { passed: credentialMatches.length === 0 && placeholderMatches.length === 0,
    credentialMatches, placeholderMatches };
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) throw new Error('At least one evidence path is required.');
  for (const path of paths) {
    const result = scanMcpEvidenceText(await readFile(path, 'utf8'));
    if (!result.passed) throw new Error('Unsafe MCP evidence detected.');
  }
}

if (process.argv[1]?.endsWith('scan-mcp-evidence.ts')) {
  void main().catch(() => { console.error('MCP evidence scan failed.'); process.exitCode = 1; });
}
