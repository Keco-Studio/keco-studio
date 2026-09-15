import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  anonClient,
  serviceClient,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const PASSWORD = 'Password123!';

describeDb('current email identity (live database)', () => {
  const createdUserIds: string[] = [];

  async function createUser(email: string) {
    const result = await serviceClient().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (result.error || !result.data.user) {
      throw new Error(`createUser failed: ${result.error?.message ?? 'missing user'}`);
    }
    createdUserIds.push(result.data.user.id);
    return result.data.user;
  }

  afterEach(async () => {
    const svc = serviceClient();
    await Promise.all(createdUserIds.splice(0).map((id) => svc.auth.admin.deleteUser(id)));
  });

  it('synchronizes a confirmed Auth email change into the profile copy', async () => {
    const suffix = randomUUID().slice(0, 8);
    const user = await createUser(`Email-Sync-${suffix}@Example.com`);
    const nextEmail = `email-sync-next-${suffix}@example.com`;

    const update = await serviceClient().auth.admin.updateUserById(user.id, {
      email: nextEmail.toUpperCase(),
      email_confirm: true,
    });
    expect(update.error).toBeNull();

    const profile = await serviceClient()
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    expect(profile.error).toBeNull();
    expect(profile.data?.email).toBe(nextEmail);
  });

  it('prevents an authenticated client from directly changing profile email', async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `profile-guard-${suffix}@example.com`;
    const user = await createUser(email);
    const client = anonClient();
    const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
    expect(signedIn.error).toBeNull();

    const update = await client
      .from('profiles')
      .update({ email: `hijacked-${suffix}@example.com` })
      .eq('id', user.id);

    expect(update.error).not.toBeNull();

    const profile = await serviceClient()
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();
    expect(profile.data?.email).toBe(email);
  });

  it('rejects a case-insensitive duplicate while the first account exists', async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `Unique-${suffix}@Example.com`;
    await createUser(email);

    const duplicate = await serviceClient().auth.admin.createUser({
      email: email.toLowerCase(),
      password: PASSWORD,
      email_confirm: true,
    });

    expect(duplicate.error).not.toBeNull();
    if (duplicate.data.user) createdUserIds.push(duplicate.data.user.id);
  });

  it('allows a deleted account email to register a new UUID', async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `released-${suffix}@example.com`;
    const original = await createUser(email);

    const deletion = await serviceClient().auth.admin.deleteUser(original.id);
    expect(deletion.error).toBeNull();
    createdUserIds.splice(createdUserIds.indexOf(original.id), 1);

    const replacement = await createUser(email);
    expect(replacement.id).not.toBe(original.id);
  });
});
