import { expect, it } from '@jest/globals';
import { scanMcpEvidenceText } from '../../../scripts/scan-mcp-evidence';

it('accepts observed non-secret evidence and rejects credentials or placeholders', () => {
  expect(scanMcpEvidenceText('{"passed":true,"searchMode":"text_fuzzy"}').passed).toBe(true);
  expect(scanMcpEvidenceText('access_token=an-actual-secret-value').passed).toBe(false);
  expect(scanMcpEvidenceText('{"refresh_token":"an-actual-secret-value"}').passed).toBe(false);
  expect(scanMcpEvidenceText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature').passed).toBe(false);
  expect(scanMcpEvidenceText('Gate: PENDING').passed).toBe(false);
});
