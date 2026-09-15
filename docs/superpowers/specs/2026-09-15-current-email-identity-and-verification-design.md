# Current Email Identity and Verification Design

## Goal And Delivery Order

Make the currently bound email unique across accounts, verify ownership of
emails used for signup and email changes using a six-digit code delivered to
the real mailbox, and keep all account and permission ownership tied to the
Supabase Auth user UUID. Preserve the existing password-recovery email-link
flow.

Deliver in two stages. Stage 1 implements current-email uniqueness,
normalization, profile synchronization, safe UUID-bound invitations, an
email-change flow using Supabase's existing email confirmation links, and
repairs to the existing password-recovery pages. It does not introduce a
six-digit code UI, enable mandatory signup confirmation, or claim that signup
email ownership has been verified. Stage 2 enables confirmed signup, adds
six-digit signup/new-email code entry and resend, and validates delivery to
real mailboxes through the hosted Auth SMTP and templates. Password recovery
keeps its one-time email link in both stages. Stage 1 is deployable for identity
consistency but does not provide the anti-impersonation guarantee of Stage 2.

## Product Rules

- Normalize email input by trimming surrounding whitespace and comparing
  case-insensitively. Do not apply provider-specific transforms such as Gmail
  dot or plus-address removal.
- An email can be bound to at most one existing Auth account at a time,
  including accounts created through OAuth. A concurrent registration or email
  change must not bypass this rule.
- In Stage 1, signup continues using the existing Auth email confirmation
  setting. In Stage 2, signup is incomplete until the user verifies the email
  with a six-digit code received at that mailbox. An unverified signup must
  not grant access to protected application data. Repeated signup attempts
  for a pending account use the Auth provider's resend/expiry behavior, not a
  second user record.
- An authenticated user may request a different email. The new email must be
  unoccupied and confirmed before it becomes the current login/recovery email.
  Stage 1 uses Supabase's existing email confirmation links. Stage 2 uses code
  entry for the new email. Keep Supabase's old-and-new email confirmation
  requirement for changes; the browser guides the user through both required
  confirmations.
- Once a change finishes, the old email is available to another account. No
  historical email ownership or reservation table is kept. The old account
  cannot switch back while a different account holds that email.
- Deleting an account releases its current email. A later signup using that
  email creates a different Auth UUID and inherits no account-level admin
  permission, project ownership, collaborator membership, or pending invite.
- Password recovery uses only the current bound email and Supabase's
  one-time recovery link. It does not create an independent OTP system.

## Identity and Data Boundaries

`auth.users.id` is the account's permanent identity for its lifetime.
`auth.users.email` is the authoritative current email. `profiles.email` is a
display/search copy, never a second identity or authorization key. A database
trigger synchronizes it only when Auth's effective current email changes,
including admin/provider changes; pending email-change fields do not count.
Backfill existing profiles from Auth and reject ambiguous normalized duplicate
groups before enabling stricter uniqueness. The database enforces normalized
uniqueness on current Auth emails, not only the application form: the existing
Auth index covers raw email on non-SSO users but does not prove this broader
rule. Do not mutate previously bound emails into permanent reservations.

The registration and login UI normalize email before calling Supabase Auth;
the uniqueness error is reported without creating another account. A signed-in
account area shows the authoritative current email and allows requesting a
change. Success is displayed only after Auth confirms the new effective email
and the profile copy reflects it. Do not expose Auth service-role credentials
or permit clients to write the profile email as if it were authoritative.

## Email Verification and Delivery

In Stage 2, use Supabase Auth's signup and email-change OTP
generation/verification rather than storing application-generated codes. The
interface sends/resends a code, accepts six digits, handles incorrect/expired
codes, and respects Auth rate limits. The Auth email templates must show the
OTP token, not only a link;
new-email verification must follow the provider's old/new confirmation flow.
The existing local configuration has email confirmation disabled, a six-digit
OTP length, and Mailpit for local delivery. Enable confirmation in the actual
hosted Auth project and configure its SMTP with an authorized, verified sender
domain and approved redirect URLs. The existing Resend API integration sends
collaboration invitations and is not automatically connected to Auth SMTP.

Neither local Mailpit success nor a configured invitation API key proves that
production Auth mail reaches real inboxes. Stage 1's email-change confirmation
and password-recovery links still depend on working Auth mail delivery; they
cannot be declared usable in production without it. Production delivery,
suppression, rate limits, and OTP templates are a Stage 2 acceptance gate.

## Invitations and Email Reuse

At invite creation, resolve the registered recipient's current Auth email to
exactly one UUID; store that UUID on the pending invitation while retaining the
email address as the delivery snapshot. Self-invites and existing collaborator
checks use UUIDs. Acceptance requires the signed-in user UUID to equal the
stored recipient UUID, not merely to have the same email at acceptance time.
On email change the pending invitation stays assigned to the original user;
on deletion a recipient-UUID foreign key cascades away pending invites for
that user. Legacy
pending invitations without an unambiguous recipient UUID fail closed until
reissued. Apply the same rule to the service-based invitation path and the
UI that derives collaborator names from invite email; email reuse cannot grant
a former user's rights to a new UUID.

## Password Recovery

Keep `/forgot-password` and `/auth/reset-password` and the provider's recovery
link. Show an email-only input, give a non-enumerating success response, support
expired-link retry, and validate the password against the configured Auth
minimum (currently 12 characters locally). Avoid asserting that mail was
actually delivered solely because the provider accepted the request. The
recovery session must identify the same Auth UUID; a newly registered account
with a reused email is not the deleted account.

## Verification and Rollout

- Stage 1: unit-test normalization, duplicate/race handling, Auth-to-profile
  sync, invite UUID validation, email-change state, and password rules.
- Stage 1: integration-test old/new confirmation links and recovery links;
  end-to-end test case-insensitive duplicates, release of old email after a
  confirmed change, deleting/re-registering with a new UUID, and a pending
  invite not moving to a new owner of its former email.
- Stage 2: integration-test signup/code delivery to local Mailpit, wrong or
  expired codes, resend cases, and old/new email-change code confirmation.
- Before migration, inspect all Auth accounts for duplicate normalized email
  groups and document a manual resolution path if any exist; do not silently
  merge users. Apply the migration before exposing the new UI. Verify hosted
  SMTP/templates and confirmation settings separately from local tests. Do
  not turn on mandatory signup confirmation until Stage 2's mail delivery and
  code UI are ready.

Out of scope: a permanent email history, custom OTP storage, username-based
password recovery, automatic merging of OAuth identities, moving old project
data to a new UUID, and changes to unrelated Keco Admin or GDD work.
