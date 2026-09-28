-- A browser may replay an interrupted multipart POST. Claim its nonce before
-- persisting the user turn, and retain the claim even if the turn fails.
create table public.agent_game_media_submissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  project_id uuid not null,
  conversation_id uuid not null,
  message_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, submission_id)
);

alter table public.agent_game_media_submissions enable row level security;
revoke all on public.agent_game_media_submissions from public, anon, authenticated;

create function public.claim_agent_game_media_submission(
  p_submission_id uuid, p_project_id uuid, p_conversation_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_submission_id is null or not exists (
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
  ) then
    return false;
  end if;

  insert into public.agent_game_media_submissions
    (user_id, submission_id, project_id, conversation_id)
  values (auth.uid(), p_submission_id, p_project_id, p_conversation_id)
  on conflict (user_id, submission_id) do nothing;
  return found;
end;
$$;

create function public.bind_agent_game_media_submission(
  p_submission_id uuid, p_message_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.agent_game_media_submissions s
  set message_id = p_message_id
  from public.agent_messages m
  where s.user_id = auth.uid() and s.submission_id = p_submission_id
    and s.message_id is null
    and m.id = p_message_id and m.role = 'user'
    and m.conversation_id = s.conversation_id
    and m.content->>'game_media_submission_id' = p_submission_id::text;
  return found;
end;
$$;

create function public.verify_agent_game_media_submission(
  p_submission_id uuid, p_message_id uuid, p_project_id uuid, p_conversation_id uuid
)
returns boolean
language sql security definer set search_path = ''
as $$
  select exists (
    select 1 from public.agent_game_media_submissions s
    join public.agent_conversations c on c.id = s.conversation_id
    where s.user_id = auth.uid() and s.submission_id = p_submission_id
      and s.message_id = p_message_id and s.project_id = p_project_id
      and s.conversation_id = p_conversation_id
      and c.user_id = auth.uid() and c.project_id = p_project_id
  );
$$;

revoke all on function public.claim_agent_game_media_submission(uuid, uuid, uuid) from public, anon;
revoke all on function public.bind_agent_game_media_submission(uuid, uuid) from public, anon;
revoke all on function public.verify_agent_game_media_submission(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.claim_agent_game_media_submission(uuid, uuid, uuid) to authenticated;
grant execute on function public.bind_agent_game_media_submission(uuid, uuid) to authenticated;
grant execute on function public.verify_agent_game_media_submission(uuid, uuid, uuid, uuid) to authenticated;
