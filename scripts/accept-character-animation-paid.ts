import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: false, quiet: true });
const enabled = process.env.KECO_ACCEPTANCE_CHARACTER_ANIMATION === "true";
const paid = process.env.KECO_ACCEPTANCE_CONFIRM_PAID === "true";
if (!enabled || !paid) {
  console.error("Paid character animation acceptance is disabled. Set KECO_ACCEPTANCE_CHARACTER_ANIMATION=true and KECO_ACCEPTANCE_CONFIRM_PAID=true intentionally.");
  process.exit(2);
}

const appUrl = process.env.KECO_ACCEPTANCE_APP_URL ?? "";
const projectId = process.env.KECO_ACCEPTANCE_PROJECT_ID ?? "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const email = process.env.KECO_ACCEPTANCE_EMAIL ?? "";
const password = process.env.KECO_ACCEPTANCE_PASSWORD ?? "";
const pollMs = Number(process.env.KECO_ACCEPTANCE_POLL_MS ?? 5_000);
const maxPolls = Number(process.env.KECO_ACCEPTANCE_MAX_POLLS ?? 180);
type Json = Record<string, unknown>;

async function call(token: string, body: Json): Promise<Json> {
  const response = await fetch(new URL("/api/mcp/character-assets", appUrl), {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as Json | null;
  if (!response.ok || !payload) throw new Error(typeof payload?.code === "string" ? payload.code : `character_api_${response.status}`);
  return payload;
}

async function generate(token: string, assetId: string, saveVersion: number): Promise<Json> {
  const prepared = await call(token, { action: "prepare_character_asset_generation", projectId, assetId, saveVersion });
  process.stdout.write(`${JSON.stringify({ event: "generation_prepared", assetId, purpose: prepared.confirmationPurpose })}\n`);
  await call(token, {
    action: "start_character_asset_generation", projectId, assetId,
    attemptId: prepared.attemptId, generationId: prepared.generationId,
    planFingerprint: prepared.planFingerprint, attemptCount: prepared.attemptCount,
    confirmationToken: prepared.confirmationToken, confirmPaidGeneration: true,
  });
  const identity = { projectId, assetId, attemptId: prepared.attemptId, generationId: prepared.generationId, planFingerprint: prepared.planFingerprint };
  for (let count = 0; count < maxPolls; count += 1) {
    const current = await call(token, { action: "advance_character_asset_generation", ...identity });
    const status = String(current.status ?? "");
    process.stdout.write(`${JSON.stringify({ event: "generation_polled", assetId, status, count: count + 1 })}\n`);
    if (status === "ready") return current;
    if (status === "failed" || status === "blocked") throw new Error(String(current.lastErrorCode ?? status));
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error("character_generation_timeout");
}

async function main(): Promise<void> {
  if (!appUrl || !projectId || !supabaseUrl || !anonKey || !email || !password) throw new Error("acceptance_environment_not_configured");
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error("acceptance_authentication_failed");
  const token = signedIn.data.session.access_token;
  const character = await call(token, {
    action: "create_character_asset_draft", projectId, idempotencyKey: randomUUID(),
    plan: { schemaVersion: 1, kind: "character", name: "Acceptance Scout", description: "Adult forest scout with a green cloak, leather boots, and a compact travel pack.", perspective: "topdown", facing: "front", width: 64, height: 64, transparent: true },
  });
  const readyCharacter = await generate(token, String(character.assetId), Number(character.saveVersion));
  const width = Number(readyCharacter.width); const height = Number(readyCharacter.height); const sha = String(readyCharacter.sha256 ?? "");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 4 || height % 4 || !/^[a-f0-9]{64}$/.test(sha)) throw new Error("ready_character_invalid");
  const animation = await call(token, {
    action: "create_character_asset_draft", projectId, idempotencyKey: randomUUID(),
    plan: { schemaVersion: 1, kind: "animation", name: "acceptance_walk", sourceCharacterAssetId: character.assetId, sourceCharacterSha256: sha, motionDescription: "Walk forward with a steady relaxed stride.", frameWidth: width, frameHeight: height, frameCount: 6, fps: 10, loop: true },
  });
  const readyAnimation = await generate(token, String(animation.assetId), Number(animation.saveVersion));
  if (Number(readyAnimation.width) !== width * 6 || Number(readyAnimation.height) !== height) throw new Error("ready_animation_geometry_invalid");
  process.stdout.write(`${JSON.stringify({ event: "character_animation_acceptance_ready", characterAssetId: character.assetId, animationAssetId: animation.assetId })}\n`);
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "character_animation_acceptance_failed"); process.exitCode = 1; });
