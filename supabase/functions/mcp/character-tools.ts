import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import { callKecoApp, type KecoAppRequest } from "./app-bridge.ts";
import type { McpRequestContext } from "./context.ts";
import { McpDomainError } from "./errors.ts";
import { toolFailure, toolSuccess } from "./results.ts";

type AppCaller = (context: McpRequestContext, request: KecoAppRequest) => Promise<unknown>;
type Dependencies = { callApp?: AppCaller; includeWrites?: boolean };
const uuid = z.string().uuid(); const fingerprint = z.string().regex(/^[a-f0-9]{64}$/); const size = z.union([z.literal(32), z.literal(64), z.literal(96), z.literal(128)]); const frameDimension = z.number().int().min(16).max(256).refine((value) => value % 4 === 0);
const prompt = z.string().min(1).max(2_000).refine((value) => value.trim().length > 0).refine((value) => !/https?:\/\/|www\.|\b(?:pixellab|mcp|api|create_character|animate_character|animate_image|animate_with_text)\b|\b(?:api\s*key|authorization|bearer|password|token)\b\s*[:=]?/i.test(value));
const characterPlan = z.object({ schemaVersion: z.literal(1), kind: z.literal("character"), name: z.string().trim().min(1).max(160), description: prompt, perspective: z.enum(["topdown", "platformer", "isometric"]), facing: z.enum(["front", "back", "left", "right"]), width: size, height: size, transparent: z.literal(true) }).strict();
const animationPlan = z.object({ schemaVersion: z.literal(1), kind: z.literal("animation"), name: z.string().trim().min(1).max(160), sourceCharacterAssetId: uuid, sourceCharacterSha256: fingerprint, motionDescription: prompt, frameWidth: frameDimension, frameHeight: frameDimension, frameCount: z.number().int().min(4).max(16).refine((value) => value % 2 === 0), fps: z.number().int().min(1).max(60), loop: z.boolean() }).strict();
const plan = z.discriminatedUnion("kind", [characterPlan, animationPlan]).refine((value) => value.kind !== "character" || value.width === value.height);
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const fields = ["projectId", "assetId", "saveVersion", "status", "plan", "generation", "attemptId", "generationId", "planFingerprint", "attemptCount", "lastErrorCode", "providerJobId", "storagePath", "sha256", "width", "height", "hasTransparency", "metadata", "imageUrl", "feeNotice", "confirmationPurpose", "confirmationExpiresAt", "confirmationToken"] as const;
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function publicPayload(value: unknown): Record<string, unknown> { const source = record(value); const output: Record<string, unknown> = {}; for (const field of fields) if (source[field] !== undefined) output[field] = source[field]; if (Array.isArray(source.items)) output.items = source.items.slice(0, 200).map(publicPayload); if (typeof source.returnedCount === "number") output.returnedCount = source.returnedCount; return output; }
function projectShape(context: McpRequestContext) { return context.mode === "account" ? { projectId: uuid } : {}; }
function projectId(context: McpRequestContext, input: Record<string, unknown>): string { if (context.mode === "project") return context.projectId; if (typeof input.projectId !== "string") throw new McpDomainError("FIELD_VALIDATION_FAILED", "A valid projectId is required."); return input.projectId; }

export function registerCharacterTools(server: McpServer, context: McpRequestContext, dependencies: Dependencies = {}): void {
  const callApp = dependencies.callApp ?? callKecoApp;
  const includeWrites = dependencies.includeWrites ?? (context.mode === "account" || context.role !== "viewer");
  const register = <Schema extends z.ZodTypeAny>(name: string, description: string, inputSchema: Schema, annotations: typeof readAnnotations) => server.registerTool(name, { description, inputSchema, annotations }, async (input: z.infer<Schema>) => {
    try { const { projectId: _projectId, ...rest } = input as Record<string, unknown>; const payload = await callApp(context, { method: "POST", path: "/api/mcp/character-assets", body: { action: name, projectId: projectId(context, input as Record<string, unknown>), ...rest } }); return toolSuccess("Character asset operation completed.", { ok: true, ...publicPayload(payload) }); }
    catch (error) { return toolFailure(error); }
  });
  register("list_character_assets", "List saved character and animation assets in the selected project.", z.object(projectShape(context)).strict(), readAnnotations);
  register("read_character_asset", "Read one saved character or animation asset and its persisted generation state.", z.object({ ...projectShape(context), assetId: uuid }).strict(), readAnnotations);
  if (includeWrites) {
    register("create_character_asset_draft", "Create an idempotent character or animation draft from text.", z.object({ ...projectShape(context), plan, idempotencyKey: uuid }).strict(), { ...writeAnnotations, idempotentHint: true });
    register("update_character_asset_draft", "Update a character or animation draft using optimistic saveVersion concurrency.", z.object({ ...projectShape(context), assetId: uuid, saveVersion: z.number().int().nonnegative(), plan }).strict(), { ...writeAnnotations, idempotentHint: true });
    register("prepare_character_asset_generation", "Freeze the exact character asset draft and return a paid-generation fee notice and confirmation token without submitting a provider job.", z.object({ ...projectShape(context), assetId: uuid, saveVersion: z.number().int().nonnegative() }).strict(), { ...writeAnnotations, idempotentHint: true });
  }
  const generation = { ...projectShape(context), assetId: uuid, attemptId: uuid, generationId: uuid, planFingerprint: fingerprint };
  if (includeWrites) {
    register("start_character_asset_generation", "Start the paid provider job only after the prepare fee notice and later explicit confirmation. Requires the exact token and literal confirmPaidGeneration true.", z.object({ ...generation, attemptCount: z.number().int().nonnegative(), confirmationToken: z.string().min(1).max(4_096), confirmPaidGeneration: z.literal(true) }).strict(), { ...writeAnnotations, idempotentHint: true, openWorldHint: true });
  }
  register("get_character_asset_generation", "Read persisted character or animation generation status without contacting the provider.", z.object(generation).strict(), { ...readAnnotations, openWorldHint: true });
  if (includeWrites) register("advance_character_asset_generation", "Poll or validate an existing character or animation job. This never starts a new paid provider submission.", z.object(generation).strict(), { ...writeAnnotations, openWorldHint: true });
}
