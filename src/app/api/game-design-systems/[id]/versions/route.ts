import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { parseRuleSet } from '@/lib/game-design-system/ruleSchema';
import { findReintroducedRuleIds } from '@/lib/game-design-system/ruleDiff';
import { createGameDesignSystemVersion, getGameDesignSystem, getGameDesignSystemDetail, getGameDesignSystemVersion, type GameDesignSystemVersion } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { redactGameDesignSystemDetailForViewer } from '@/lib/game-design-system/sourceVisibility.server';

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  try {
    const system = await getGameDesignSystemDetail(supabase, id, { versionClient: getSupabaseServiceRoleClient() });
    if (!system) return NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
    const visible = await redactGameDesignSystemDetailForViewer(supabase, system, user.id);
    return NextResponse.json({ versions: visible.versions });
  } catch (error) {
    return NextResponse.json({ error: 'Versions could not be loaded.' }, { status: 404 });
  }
});

export const POST = withAuth(async function POST(request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  const body = await request.json().catch(() => null) as { rules?: unknown; parentVersionId?: unknown } | null;
  let rules;
  try {
    rules = parseRuleSet(body?.rules);
  } catch {
    return NextResponse.json({ error: 'Invalid structured rules.' }, { status: 400 });
  }
  const parentVersionId = typeof body?.parentVersionId === 'string' ? body.parentVersionId : null;
  try {
    const versionClient = getSupabaseServiceRoleClient();
    const system = await getGameDesignSystem(supabase, id);
    if (!system) return NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
    if (system.source !== 'user' || system.owner_id !== user.id) return NextResponse.json({ error: 'Only the owner can create a version.' }, { status: 403 });
    const parent = parentVersionId ? await getGameDesignSystemVersion(versionClient, parentVersionId) : null;
    if (parentVersionId && (!parent || parent.system_id !== id)) return NextResponse.json({ error: 'Parent version does not belong to this system.' }, { status: 400 });
    if (parent) {
      const ancestors: GameDesignSystemVersion['rules'][] = [];
      const visited = new Set([parent.id]);
      let ancestorId = parent.parent_version_id;
      while (ancestorId) {
        if (visited.has(ancestorId)) throw new Error('Version lineage contains a cycle.');
        visited.add(ancestorId);
        const ancestor = await getGameDesignSystemVersion(versionClient, ancestorId);
        if (!ancestor) throw new Error('Version lineage is incomplete.');
        ancestors.push(parseRuleSet(ancestor.rules));
        ancestorId = ancestor.parent_version_id;
      }
      const reintroduced = findReintroducedRuleIds(parseRuleSet(parent.rules), rules, ancestors);
      if (reintroduced.length > 0) {
        return NextResponse.json({
          error: 'Rule IDs cannot be reintroduced after deletion.',
          ruleIds: reintroduced,
        }, { status: 409 });
      }
    }
    const version = await createGameDesignSystemVersion(versionClient, {
      systemId: id,
      title: system.title,
      createdBy: user.id,
      rules,
      parentVersion: parent,
      sourceSnapshots: parent?.source_snapshots ?? [],
    });
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/game-design-systems/:id/versions]', error);
    return NextResponse.json({ error: 'Version could not be created.' }, { status: 400 });
  }
});
