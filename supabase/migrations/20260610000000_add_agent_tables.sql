-- Keco-Studio Agent tables
-- Conversation history, message log, pending confirmations, and audit traces.

-- Conversation metadata
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Message history
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Pending confirmations (DB as single source of truth for suspended ReAct loops)
CREATE TABLE IF NOT EXISTS public.agent_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  args jsonb NOT NULL,
  confirmation_mode text NOT NULL CHECK (confirmation_mode IN ('pre_execute', 'post_preview', 'meta')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  suspended_state jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '30 minutes'
);

-- Audit traces
CREATE TABLE IF NOT EXISTS public.agent_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  turn_id text NOT NULL,
  user_message text,
  llm_calls jsonb DEFAULT '[]'::jsonb,
  tool_calls jsonb DEFAULT '[]'::jsonb,
  confirmations jsonb DEFAULT '[]'::jsonb,
  total_latency_ms integer,
  token_usage jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_conv_user ON public.agent_conversations(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_agent_msg_conv ON public.agent_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_pending_expires ON public.agent_pending_actions(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_agent_traces_user ON public.agent_traces(user_id, created_at);

-- Enable RLS
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_traces ENABLE ROW LEVEL SECURITY;

-- agent_conversations: user owns their conversations AND has access to the project
DROP POLICY IF EXISTS "Users can view own conversations" ON public.agent_conversations;
CREATE POLICY "Users can view own conversations" ON public.agent_conversations
  FOR SELECT USING (
    user_id = auth.uid()
    AND (
      project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
      OR project_id IN (SELECT project_id FROM public.project_collaborators WHERE user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "Users can insert own conversations" ON public.agent_conversations;
CREATE POLICY "Users can insert own conversations" ON public.agent_conversations
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
      OR project_id IN (SELECT project_id FROM public.project_collaborators WHERE user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "Users can update own conversations" ON public.agent_conversations;
CREATE POLICY "Users can update own conversations" ON public.agent_conversations
  FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can delete own conversations" ON public.agent_conversations;
CREATE POLICY "Users can delete own conversations" ON public.agent_conversations
  FOR DELETE USING (user_id = auth.uid());

-- agent_messages: accessible through conversation ownership
DROP POLICY IF EXISTS "Users can view messages of own conversations" ON public.agent_messages;
CREATE POLICY "Users can view messages of own conversations" ON public.agent_messages
  FOR SELECT USING (
    conversation_id IN (SELECT id FROM public.agent_conversations WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can insert messages to own conversations" ON public.agent_messages;
CREATE POLICY "Users can insert messages to own conversations" ON public.agent_messages
  FOR INSERT WITH CHECK (
    conversation_id IN (SELECT id FROM public.agent_conversations WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can delete messages of own conversations" ON public.agent_messages;
CREATE POLICY "Users can delete messages of own conversations" ON public.agent_messages
  FOR DELETE USING (
    conversation_id IN (SELECT id FROM public.agent_conversations WHERE user_id = auth.uid())
  );

-- agent_pending_actions: same pattern
DROP POLICY IF EXISTS "Users can view own pending actions" ON public.agent_pending_actions;
CREATE POLICY "Users can view own pending actions" ON public.agent_pending_actions
  FOR SELECT USING (
    conversation_id IN (SELECT id FROM public.agent_conversations WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can insert own pending actions" ON public.agent_pending_actions;
CREATE POLICY "Users can insert own pending actions" ON public.agent_pending_actions
  FOR INSERT WITH CHECK (
    conversation_id IN (SELECT id FROM public.agent_conversations WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can update own pending actions" ON public.agent_pending_actions;
CREATE POLICY "Users can update own pending actions" ON public.agent_pending_actions
  FOR UPDATE USING (
    conversation_id IN (SELECT id FROM public.agent_conversations WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can delete own pending actions" ON public.agent_pending_actions;
CREATE POLICY "Users can delete own pending actions" ON public.agent_pending_actions
  FOR DELETE USING (
    conversation_id IN (SELECT id FROM public.agent_conversations WHERE user_id = auth.uid())
  );

-- agent_traces: owner can view; project admins can view project traces
DROP POLICY IF EXISTS "Users can view own traces" ON public.agent_traces;
CREATE POLICY "Users can view own traces" ON public.agent_traces
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Project admins can view project traces" ON public.agent_traces;
CREATE POLICY "Project admins can view project traces" ON public.agent_traces
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM public.agent_conversations
      WHERE project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "Users can insert own traces" ON public.agent_traces;
CREATE POLICY "Users can insert own traces" ON public.agent_traces
  FOR INSERT WITH CHECK (user_id = auth.uid());
