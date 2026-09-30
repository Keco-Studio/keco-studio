import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);
const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('agent game-media submission binding', () => {
  let fx: ProjectFixture;
  let conversationId: string;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    const { data, error } = await fx.editor.client.from('agent_conversations')
      .insert({ user_id: fx.editor.id, project_id: fx.projectId, meta: {} })
      .select('id').single();
    if (error || !data) throw error ?? new Error('Conversation fixture failed');
    conversationId = data.id;
  }, 120_000);

  afterAll(async () => {
    if (conversationId) await fx.svc.from('agent_conversations').delete().eq('id', conversationId);
    if (fx) await teardownProjectFixture(fx);
  }, 60_000);

  it('claims a nonce once and verifies its exact saved user message', async () => {
    const submissionId = crypto.randomUUID();
    const args = {
      p_submission_id: submissionId,
      p_project_id: fx.projectId,
      p_conversation_id: conversationId,
    };
    const first = await fx.editor.client.rpc('claim_agent_game_media_submission', args);
    const replay = await fx.editor.client.rpc('claim_agent_game_media_submission', args);
    expect(first).toMatchObject({ data: true, error: null });
    expect(replay).toMatchObject({ data: false, error: null });

    const { data: message, error } = await fx.editor.client.from('agent_messages')
      .insert({ conversation_id: conversationId, role: 'user', content: {
        content: 'Upload my guide', game_media_submission_id: submissionId,
      } }).select('id').single();
    expect(error).toBeNull();
    const messageId = message!.id;
    expect(await fx.editor.client.rpc('bind_agent_game_media_submission', {
      p_submission_id: submissionId, p_message_id: messageId,
    })).toMatchObject({ data: true, error: null });
    expect(await fx.editor.client.rpc('verify_agent_game_media_submission', {
      ...args, p_message_id: messageId,
    })).toMatchObject({ data: true, error: null });
    expect(await fx.owner.client.rpc('verify_agent_game_media_submission', {
      ...args, p_message_id: messageId,
    })).toMatchObject({ data: false, error: null });

    await fx.editor.client.from('agent_messages').delete().eq('id', messageId);
    expect(await fx.editor.client.rpc('claim_agent_game_media_submission', args))
      .toMatchObject({ data: false, error: null });
  });
});
