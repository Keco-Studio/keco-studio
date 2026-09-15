import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  serviceClient,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('invitation recipient identity (live database)', () => {
  let fixture: ProjectFixture;

  beforeAll(async () => {
    fixture = await buildProjectFixture();
  }, 120_000);

  afterAll(async () => {
    if (fixture) await teardownProjectFixture(fixture);
  }, 60_000);

  it('stores the recipient UUID and removes the invitation with that account', async () => {
    const invitationId = randomUUID();
    const inserted = await serviceClient()
      .from('collaboration_invitations')
      .insert({
        id: invitationId,
        project_id: fixture.projectId,
        recipient_user_id: fixture.outsider.id,
        recipient_email: fixture.outsider.email,
        role: 'viewer',
        invited_by: fixture.owner.id,
        invitation_token: `recipient-identity-${randomUUID()}`,
      });
    expect(inserted.error).toBeNull();

    const deletion = await serviceClient().auth.admin.deleteUser(fixture.outsider.id);
    expect(deletion.error).toBeNull();

    const invitation = await serviceClient()
      .from('collaboration_invitations')
      .select('id')
      .eq('id', invitationId)
      .maybeSingle();
    expect(invitation.error).toBeNull();
    expect(invitation.data).toBeNull();
  });
});
