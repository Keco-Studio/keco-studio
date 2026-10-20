-- A Map reference upload must originate in one authenticated multipart user turn.
create table public.agent_map_reference_submissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  project_id uuid not null,
  conversation_id uuid not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  message_id uuid unique,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, submission_id)
);

alter table public.agent_map_reference_submissions enable row level security;
revoke all on public.agent_map_reference_submissions from public, anon, authenticated;

create function public.claim_agent_map_reference_submission(
  p_submission_id uuid, p_project_id uuid, p_conversation_id uuid, p_sha256 text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_submission_id is null
    or p_sha256 !~ '^[a-f0-9]{64}$'
    or not exists (
      select 1 from public.agent_conversations c
      where c.id = p_conversation_id and c.user_id = auth.uid()
        and c.project_id = p_project_id
    ) or not exists (
      select 1 from public.projects p
      where p.id = p_project_id and (
        p.owner_id = auth.uid() or exists (
          select 1 from public.project_collaborators pc
          where pc.project_id = p_project_id and pc.user_id = auth.uid()
            and pc.accepted_at is not null and pc.role in ('admin', 'editor')
        )
      )
    )
  then
    return false;
  end if;

  insert into public.agent_map_reference_submissions
    (user_id, submission_id, project_id, conversation_id, sha256)
  values (auth.uid(), p_submission_id, p_project_id, p_conversation_id, p_sha256)
  on conflict (user_id, submission_id) do nothing;
  return found;
end;
$$;

create function public.bind_agent_map_reference_submission(
  p_submission_id uuid, p_message_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.agent_map_reference_submissions s
  set message_id = p_message_id
  from public.agent_messages m
  where s.user_id = auth.uid() and s.submission_id = p_submission_id
    and s.message_id is null
    and m.id = p_message_id and m.role = 'user'
    and m.conversation_id = s.conversation_id
    and m.content->>'map_reference_submission_id' = p_submission_id::text
    and m.content->'map_reference_attachment'->>'sha256' = s.sha256;
  return found;
end;
$$;

create function public.consume_agent_map_reference_submission(
  p_submission_id uuid, p_message_id uuid, p_project_id uuid,
  p_conversation_id uuid, p_sha256 text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.agent_map_reference_submissions s
  set consumed_at = clock_timestamp()
  from public.agent_conversations c
  where s.user_id = auth.uid() and s.submission_id = p_submission_id
    and s.message_id = p_message_id and s.project_id = p_project_id
    and s.conversation_id = p_conversation_id and s.sha256 = p_sha256
    and s.consumed_at is null
    and c.id = s.conversation_id and c.user_id = auth.uid()
    and c.project_id = p_project_id
    and exists (
      select 1 from public.projects p
      where p.id = p_project_id and (
        p.owner_id = auth.uid() or exists (
          select 1 from public.project_collaborators pc
          where pc.project_id = p_project_id and pc.user_id = auth.uid()
            and pc.accepted_at is not null and pc.role in ('admin', 'editor')
        )
      )
    )
    and exists (
      select 1 from public.agent_messages m
      where m.id = p_message_id and m.role = 'user'
        and m.conversation_id = p_conversation_id
        and m.content->>'map_reference_submission_id' = p_submission_id::text
        and m.content->'map_reference_attachment'->>'sha256' = p_sha256
    );
  return found;
end;
$$;

revoke all on function public.claim_agent_map_reference_submission(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.bind_agent_map_reference_submission(uuid, uuid) from public, anon;
revoke all on function public.consume_agent_map_reference_submission(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.claim_agent_map_reference_submission(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.bind_agent_map_reference_submission(uuid, uuid) to authenticated;
grant execute on function public.consume_agent_map_reference_submission(uuid, uuid, uuid, uuid, text) to authenticated;
