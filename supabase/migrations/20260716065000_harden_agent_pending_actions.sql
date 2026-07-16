-- Pending confirmation payloads are API-only. The service role owns their
-- lifecycle and retains approved/rejected rows as replay-resistant tombstones
-- until expires_at.
DROP POLICY IF EXISTS "Users can view own pending actions" ON public.agent_pending_actions;
DROP POLICY IF EXISTS "Users can insert own pending actions" ON public.agent_pending_actions;
DROP POLICY IF EXISTS "Users can update own pending actions" ON public.agent_pending_actions;
DROP POLICY IF EXISTS "Users can delete own pending actions" ON public.agent_pending_actions;
