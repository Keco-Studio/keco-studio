import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.GDS_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function sql(statement: string): Promise<string> {
  const { stdout } = await execFileAsync('psql', [
    databaseUrl,
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-Atq',
    '-c', statement,
  ], { maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const [ownerId, adminId, editorId] = (await sql('select id::text from auth.users order by created_at limit 3;')).split('\n');
  assert(ownerId && adminId && editorId, 'Local Supabase needs at least three auth users for the verifier.');

  const jobId = randomUUID();
  const outputSystemId = randomUUID();
  const targetSystemId = randomUUID();
  const privateParentSystemId = randomUUID();
  const privateParentVersionId = randomUUID();
  const rlsProjectId = randomUUID();
  const rlsJobId = randomUUID();
  const forbiddenJobId = randomUUID();
  const rlsOwnedSystemId = randomUUID();
  const rlsOwnedVersionId = randomUUID();
  const forbiddenVersionId = randomUUID();
  const idempotencyKey = `verify-${randomUUID()}`;

  const claimable = Number(await sql(`
    select count(*) from public.game_design_system_generation_jobs
    where attempt_count < max_attempts and (
      (status = 'queued' and available_at <= now())
      or (status = 'running' and lease_expires_at < now())
    );
  `));
  assert(claimable === 0, `Refusing to run while ${claimable} unrelated job(s) are claimable.`);
  const convertedOfficialCount = Number(await sql(`
    select count(*)
    from public.game_design_systems as system
    join public.game_design_system_versions as version on version.id = system.current_version_id
    where system.source = 'official'
      and system.migration_status = 'ready'
      and jsonb_array_length(version.rules -> 'rules') >= 3
      and exists (
        select 1 from jsonb_array_elements(version.source_snapshots) as snapshot
        where snapshot ->> 'kind' = 'legacy_markdown'
          and coalesce(snapshot ->> 'excerpt', '') <> ''
      )
      and version.content_hash = encode(extensions.digest(convert_to(version.rules::text, 'UTF8'), 'sha256'), 'hex');
  `));
  assert(convertedOfficialCount >= 3, 'Official legacy systems were not converted to canonical version 1 rules.');

  try {
    await sql(`
      insert into public.game_design_system_generation_jobs (
        id, owner_id, status, phase, input, idempotency_key, input_hash, created_at, available_at
      ) values (
        '${jobId}', '${ownerId}', 'queued', 'collecting', '{}'::jsonb,
        '${idempotencyKey}', repeat('a', 64), '2000-01-01T00:00:00Z', now() - interval '1 second'
      );
    `);

    const claim = (workerId: string) => sql(`
      select coalesce((
        select row_to_json(claimed)::text
        from public.claim_game_design_system_generation_job('${workerId}', 30) claimed
      ), '');
    `);
    const firstClaims = await Promise.all([claim('verify-worker-a'), claim('verify-worker-b')]);
    const claimedRows = firstClaims.filter(Boolean).map((value) => JSON.parse(value) as { id: string; attempt_count: number; lease_owner: string });
    assert(claimedRows.length === 1, `Expected one concurrent claim, received ${claimedRows.length}.`);
    assert(claimedRows[0].id === jobId && claimedRows[0].attempt_count === 1, 'The first claim did not lease the verifier job.');

    await sql(`update public.game_design_system_generation_jobs set lease_expires_at = now() - interval '1 second' where id = '${jobId}';`);
    const recoveredRaw = await claim('verify-worker-c');
    assert(recoveredRaw, 'Expired lease was not reclaimed.');
    const recovered = JSON.parse(recoveredRaw) as { id: string; attempt_count: number; lease_owner: string };
    assert(recovered.id === jobId && recovered.attempt_count === 2 && recovered.lease_owner === 'verify-worker-c', 'Lease recovery returned the wrong state.');

    const retryStatus = await sql(`select public.retry_game_design_system_generation_job('${jobId}', 'verify-worker-c', 'verification retry', 1);`);
    assert(retryStatus === 'queued', `Expected queued retry, received ${retryStatus}.`);
    const retryState = await sql(`
      select status || '|' || phase || '|' || coalesce(lease_owner, '') || '|' || (lease_expires_at is null)::text
      from public.game_design_system_generation_jobs where id = '${jobId}';
    `);
    assert(retryState === 'queued|collecting||true', `Retry did not clear the lease: ${retryState}.`);

    await sql(`
      update public.game_design_system_generation_jobs
      set status = 'running', phase = 'generating', attempt_count = max_attempts,
          lease_owner = 'dead-final-worker', lease_expires_at = now() - interval '1 second'
      where id = '${jobId}';
    `);
    const exhaustedClaim = await claim('verify-worker-after-final-crash');
    assert(!exhaustedClaim, 'An exhausted final-attempt job was incorrectly reclaimed.');
    const exhaustedState = await sql(`
      select status || '|' || phase || '|' || coalesce(lease_owner, '') || '|' || (completed_at is not null)::text
      from public.game_design_system_generation_jobs where id = '${jobId}';
    `);
    assert(exhaustedState === 'failed|failed||true', `Final-attempt crash was not made terminal: ${exhaustedState}.`);

    await sql(`
      insert into public.game_design_systems (id, owner_id, source, title, body, generation_job_id)
      values ('${outputSystemId}', '${ownerId}', 'user', 'Verifier output', '# Verifier output', '${jobId}');
      do $verify$
      begin
        insert into public.game_design_systems (owner_id, source, title, body, generation_job_id)
        values ('${ownerId}', 'user', 'Duplicate verifier output', '# Duplicate', '${jobId}');
        raise exception 'generation_job_id uniqueness was not enforced';
      exception when unique_violation then
        null;
      end
      $verify$;
    `);

    const officialVersionId = await sql(`
      select current_version_id::text from public.game_design_systems
      where source = 'official' and current_version_id is not null order by id limit 1;
    `);
    assert(officialVersionId, 'No official version is available for inheritance verification.');
    await sql(`
      begin;
      insert into public.game_design_systems (id, owner_id, source, title, body)
      values
        ('${targetSystemId}', '${ownerId}', 'user', 'Inheritance target', '# Target'),
        ('${privateParentSystemId}', '${adminId}', 'user', 'Private parent', '# Private');
      insert into public.game_design_system_versions (
        id, system_id, version_number, rules, rendered_markdown, source_snapshots,
        diff, conflicts, content_hash, created_by
      )
      select
        '${privateParentVersionId}', '${privateParentSystemId}', 1, rules, rendered_markdown,
        '[]'::jsonb, diff, '[]'::jsonb, repeat('b', 64), '${adminId}'
      from public.game_design_system_versions where id = '${officialVersionId}';
      select set_config('request.jwt.claim.role', 'service_role', true);
      select (public.create_game_design_system_version(
        '${targetSystemId}', '${officialVersionId}', rules, '# Derived', '[]'::jsonb,
        '{"added":[],"removed":[],"changed":[],"conflicts":[]}'::jsonb,
        '[]'::jsonb, repeat('c', 64), '${ownerId}', null
      )).id
      from public.game_design_system_versions where id = '${officialVersionId}';
      do $verify$
      declare inherited_rules jsonb;
      begin
        select rules into inherited_rules from public.game_design_system_versions where id = '${officialVersionId}';
        perform public.create_game_design_system_version(
          '${targetSystemId}', '${privateParentVersionId}', inherited_rules, '# Forbidden', '[]'::jsonb,
          '{"added":[],"removed":[],"changed":[],"conflicts":[]}'::jsonb,
          '[]'::jsonb, repeat('d', 64), '${ownerId}', null
        );
        raise exception 'private external inheritance was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      rollback;
    `);

    await sql(`
      begin;
      select set_config('request.jwt.claim.role', 'service_role', true);
      do $verify$
      declare
        source_rules jsonb;
        first_version public.game_design_system_versions;
        repeated_version public.game_design_system_versions;
        output_count integer;
        system_metadata_matches boolean;
      begin
        select rules into source_rules
        from public.game_design_system_versions where id = '${officialVersionId}';
        source_rules := jsonb_set(
          jsonb_set(
            source_rules,
            '{suitableFor}',
            to_jsonb('Examples containing __KECO_ATOMIC_VERSION_LINE__'::text)
          ),
          '{rules,0,statement}',
          to_jsonb('Keep literal __KECO_ATOMIC_VERSION_LINE__ and legacy __GDS_VERSION__ content.'::text)
        );
        first_version := public.create_game_design_system_version(
          '${outputSystemId}', null, source_rules,
          E'# Verifier output\\n\\n> Version: __KECO_ATOMIC_VERSION_LINE__\\n> Suitable For: Examples containing __KECO_ATOMIC_VERSION_LINE__\\n\\nKeep literal __KECO_ATOMIC_VERSION_LINE__ and legacy __GDS_VERSION__ content.', '[]'::jsonb,
          '{"added":[],"removed":[],"changed":[],"conflicts":[]}'::jsonb,
          '[]'::jsonb, repeat('7', 64), '${ownerId}', '${jobId}'
        );
        repeated_version := public.create_game_design_system_version(
          '${outputSystemId}', null, source_rules,
          E'# Verifier output\\n\\n> Version: __KECO_ATOMIC_VERSION_LINE__\\n> Suitable For: Examples containing __KECO_ATOMIC_VERSION_LINE__\\n\\nKeep literal __KECO_ATOMIC_VERSION_LINE__ and legacy __GDS_VERSION__ content.', '[]'::jsonb,
          '{"added":[],"removed":[],"changed":[],"conflicts":[]}'::jsonb,
          '[]'::jsonb, repeat('7', 64), '${ownerId}', '${jobId}'
        );
        if first_version.id <> repeated_version.id then
          raise exception 'generation output version was duplicated';
        end if;
        select count(*) into output_count
        from public.game_design_system_versions where generation_job_id = '${jobId}';
        if output_count <> 1 then raise exception 'expected one generated version, found %', output_count; end if;
        if first_version.version_number <> 1
          or first_version.rendered_markdown not like '%> Version: 1%' then
          raise exception 'atomic Markdown version projection was incorrect';
        end if;
        if first_version.rendered_markdown not like '%> Suitable For: Examples containing __KECO_ATOMIC_VERSION_LINE__%'
          or first_version.rendered_markdown not like '%Keep literal __KECO_ATOMIC_VERSION_LINE__ and legacy __GDS_VERSION__ content.%' then
          raise exception 'marker-like user content was rewritten';
        end if;
        select system.genres = array(select jsonb_array_elements_text(source_rules -> 'genres'))
          and system.philosophies = array(select jsonb_array_elements_text(source_rules -> 'philosophies'))
          and system.suitable_for = source_rules ->> 'suitableFor'
        into system_metadata_matches
        from public.game_design_systems system where system.id = '${outputSystemId}';
        if not system_metadata_matches then raise exception 'current system metadata was not synchronized'; end if;
        begin
          delete from public.game_design_system_generation_jobs where id = '${jobId}';
          raise exception 'referenced generation job deletion was not restricted';
        exception
          when foreign_key_violation then null;
          when sqlstate '55000' then
            raise exception 'job deletion reached the immutable-version trigger instead of the foreign key';
        end;
      end
      $verify$;
      select 'atomic-version-ok';
      commit;
    `).then((result) => assert(result.includes('atomic-version-ok'), 'Atomic version verification did not complete.'));

    const officialSystemId = await sql(`select system_id::text from public.game_design_system_versions where id = '${officialVersionId}';`);
    await sql(`
      begin;
      insert into public.projects (id, owner_id, name, description)
      values ('${rlsProjectId}', '${ownerId}', 'GDS RLS verifier', 'rolled back');
      insert into public.game_design_systems (id, owner_id, source, title, body)
      values ('${rlsOwnedSystemId}', '${ownerId}', 'user', 'RLS owned system', '# RLS owned system');
      insert into public.game_design_system_versions (
        id, system_id, version_number, rules, rendered_markdown, source_snapshots,
        diff, conflicts, content_hash, created_by
      )
      select '${rlsOwnedVersionId}', '${rlsOwnedSystemId}', 1, rules, '# Needs migration', '[]'::jsonb,
        diff, '[]'::jsonb, repeat('9', 64), '${ownerId}'
      from public.game_design_system_versions where id = '${officialVersionId}';
      update public.game_design_systems
      set current_version_id = '${rlsOwnedVersionId}', migration_status = 'needs_migration'
      where id = '${rlsOwnedSystemId}';
      insert into public.project_collaborators (
        project_id, user_id, role, invited_by, invited_at, accepted_at
      ) values
        ('${rlsProjectId}', '${adminId}', 'admin', '${ownerId}', now(), now()),
        ('${rlsProjectId}', '${editorId}', 'editor', '${ownerId}', now(), now());
      insert into public.game_design_system_generation_jobs (id, owner_id, input)
      values ('${rlsJobId}', '${ownerId}', '{}'::jsonb);

      select set_config('request.jwt.claims', '{"sub":"${ownerId}","role":"authenticated"}', true);
      set local role authenticated;
      do $verify$
      begin
        insert into public.game_design_system_generation_jobs (id, owner_id, input)
        values ('${forbiddenJobId}', '${ownerId}', '{"sourceSnapshots":[{"excerpt":"forged"}]}'::jsonb);
        raise exception 'authenticated job insert was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      do $verify$
      begin
        insert into public.game_design_system_versions (
          id, system_id, version_number, rules, rendered_markdown, source_snapshots,
          diff, conflicts, content_hash, created_by
        )
        select '${forbiddenVersionId}', '${rlsOwnedSystemId}', 1, rules, '# Forged', '[]'::jsonb,
          diff, '[]'::jsonb, repeat('e', 64), '${ownerId}'
        from public.game_design_system_versions where id = '${officialVersionId}';
        raise exception 'authenticated version insert was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      do $verify$
      declare inherited_rules jsonb;
      begin
        select rules into inherited_rules from public.game_design_system_versions where id = '${officialVersionId}';
        perform public.create_game_design_system_version(
          '${rlsOwnedSystemId}', null, inherited_rules, '# Forged RPC', '[]'::jsonb,
          '{"added":[],"removed":[],"changed":[],"conflicts":[]}'::jsonb,
          '[]'::jsonb, repeat('f', 64), '${ownerId}', null
        );
        raise exception 'authenticated version RPC was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      do $verify$
      begin
        update public.game_design_systems set body = '# Forged body'
        where id = '${rlsOwnedSystemId}';
        raise exception 'authenticated protected system update was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      do $verify$
      begin
        perform source_snapshots from public.game_design_system_versions
        where id = '${officialVersionId}';
        raise exception 'authenticated source snapshot read was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      do $verify$
      begin
        if not exists (
          select 1 from public.game_design_system_versions
          where id = '${officialVersionId}' and rules is not null
        ) then
          raise exception 'authenticated canonical rule read was unexpectedly denied';
        end if;
      end
      $verify$;
      do $verify$
      begin
        insert into public.project_game_design_systems (project_id, design_system_id, version_id, applied_by)
        values ('${rlsProjectId}', '${rlsOwnedSystemId}', '${rlsOwnedVersionId}', '${ownerId}');
        raise exception 'needs_migration binding was not rejected';
      exception when check_violation then
        null;
      end
      $verify$;
      insert into public.project_game_design_systems (project_id, design_system_id, version_id, applied_by)
      values ('${rlsProjectId}', '${officialSystemId}', '${officialVersionId}', '${ownerId}');
      reset role;
      delete from public.project_game_design_systems where project_id = '${rlsProjectId}';

      select set_config('request.jwt.claims', '{"sub":"${ownerId}","role":"authenticated"}', true);
      set local role authenticated;
      do $verify$
      begin
        insert into public.project_game_design_systems (project_id, design_system_id, version_id, applied_by)
        values ('${rlsProjectId}', '${officialSystemId}', '${officialVersionId}', '${adminId}');
        raise exception 'binding audit identity spoof was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      reset role;

      select set_config('request.jwt.claims', '{"sub":"${adminId}","role":"authenticated"}', true);
      set local role authenticated;
      insert into public.project_game_design_systems (project_id, design_system_id, version_id, applied_by)
      values ('${rlsProjectId}', '${officialSystemId}', '${officialVersionId}', '${adminId}');
      reset role;
      delete from public.project_game_design_systems where project_id = '${rlsProjectId}';

      select set_config('request.jwt.claims', '{"sub":"${editorId}","role":"authenticated"}', true);
      set local role authenticated;
      do $verify$
      begin
        insert into public.project_game_design_systems (project_id, design_system_id, version_id, applied_by)
        values ('${rlsProjectId}', '${officialSystemId}', '${officialVersionId}', '${editorId}');
        raise exception 'editor binding was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      reset role;

      select set_config('request.jwt.claims', '{"sub":"${ownerId}","role":"authenticated"}', true);
      set local role authenticated;
      do $verify$
      begin
        update public.game_design_system_generation_jobs set phase = 'saving' where id = '${rlsJobId}';
        raise exception 'authenticated job update was not rejected';
      exception when insufficient_privilege then
        null;
      end
      $verify$;
      reset role;

      do $verify$
      begin
        update public.game_design_system_versions set rendered_markdown = '# Mutated' where id = '${officialVersionId}';
        raise exception 'immutable version update was not rejected';
      exception when sqlstate '55000' then
        null;
      end
      $verify$;
      select 'rls-ok';
      rollback;
    `).then((result) => assert(result.includes('rls-ok'), 'RLS transaction did not complete.'));

    process.stdout.write([
      'Game Design System database verification passed:',
      '- concurrent claim exclusion: passed',
      '- expired lease recovery: passed',
      '- retry lease cleanup: passed',
      '- final-attempt crash recovery: passed',
      '- generation output idempotency: passed',
      '- atomic version numbering and metadata synchronization: passed',
      '- marker-like projection content preservation: passed',
      '- immutable generation provenance deletion restriction: passed',
      '- external inheritance authorization: passed',
      '- legacy compatibility conversion and hash: passed',
      '- needs_migration binding: denied',
      '- owner/admin/editor binding RLS: passed',
      '- authenticated direct job/version/RPC writes: denied',
      '- protected system-column writes: denied',
      '- source snapshot direct reads: denied; canonical rules readable',
      '- binding audit identity spoofing: denied',
      '- job update and version immutability RLS: passed',
      '',
    ].join('\n'));
  } finally {
    await sql(`delete from public.game_design_systems where id = '${outputSystemId}'; delete from public.game_design_system_generation_jobs where id = '${jobId}';`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
