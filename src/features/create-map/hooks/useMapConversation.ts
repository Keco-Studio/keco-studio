"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/SupabaseContext";
import { createMapConversationService } from "../services/mapConversationService";

export function useMapConversation(
  _projectId: string,
  conversationId: string | null,
) {
  const supabase = useSupabase();
  const service = useMemo(
    () => createMapConversationService(supabase),
    [supabase],
  );
  const query = useQuery({
    queryKey: ["create-map", "conversation", conversationId],
    queryFn: () => service.readConversation(conversationId as string),
    enabled: Boolean(conversationId),
    staleTime: 5_000,
  });
  return { ...query, snapshot: query.data ?? null, service };
}

export function useAgentMapConversation(
  projectId: string,
  agentConversationId: string | null,
) {
  const supabase = useSupabase();
  const service = useMemo(
    () => createMapConversationService(supabase),
    [supabase],
  );
  const query = useQuery({
    queryKey: ["create-map", "agent-conversation", projectId, agentConversationId],
    queryFn: () => service.readAgentConversation(projectId, agentConversationId as string),
    enabled: Boolean(projectId && agentConversationId),
    staleTime: 5_000,
  });
  return { ...query, snapshot: query.data ?? null, service };
}
