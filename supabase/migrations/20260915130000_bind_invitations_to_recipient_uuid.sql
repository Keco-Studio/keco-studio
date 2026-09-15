-- Bind invitations to an account UUID so a reused email cannot inherit access.

alter table public.collaboration_invitations
  add column if not exists recipient_user_id uuid
  references public.profiles(id) on delete cascade;

with unique_profile_email as (
  select lower(btrim(email)) as normalized_email, min(id::text)::uuid as user_id
  from public.profiles
  where email is not null
  group by lower(btrim(email))
  having count(*) = 1
)
update public.collaboration_invitations as invitation
set recipient_user_id = matched.user_id
from unique_profile_email as matched
where invitation.recipient_user_id is null
  and lower(btrim(invitation.recipient_email)) = matched.normalized_email;

create index if not exists idx_collaboration_invitations_pending_recipient
  on public.collaboration_invitations (project_id, recipient_user_id)
  where accepted_at is null;

comment on column public.collaboration_invitations.recipient_user_id is
  'Stable Auth/profile UUID authorized to accept; recipient_email is only a delivery snapshot.';

notify pgrst, 'reload schema';
