import { enforceRlsDbTestRun } from './rlsTestClient';

describe('RLS database test run guard', () => {
  it('fails when a required live suite is not enabled', () => {
    expect(() => enforceRlsDbTestRun(true, false)).toThrow(
      'REQUIRE_RLS_DB_TESTS=1 requires the local RLS database suite to be enabled',
    );
  });

  it('allows optional skips and enabled required runs', () => {
    expect(() => enforceRlsDbTestRun(false, false)).not.toThrow();
    expect(() => enforceRlsDbTestRun(true, true)).not.toThrow();
  });
});
