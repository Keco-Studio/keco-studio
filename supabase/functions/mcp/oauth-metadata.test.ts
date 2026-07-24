import { assertEquals, assertThrows } from "@std/assert";
import {
  buildProtectedResourceMetadata,
  buildProtectedResourceMetadataUrl,
  InvalidMcpMetadataConfigError,
  InvalidMcpMetadataRequestError,
  isProtectedResourceMetadataPath,
  parseProtectedResourceMetadataProjectId,
} from "./oauth-metadata.ts";

const projectId = "11111111-1111-4111-8111-111111111111";

Deno.test("recognizes exact direct and gateway metadata paths", () => {
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource"),
  ), true);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource"),
  ), true);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource/extra"),
  ), false);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://user:pass@abc.supabase.co/mcp/oauth-protected-resource"),
  ), false);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource#fragment"),
  ), false);
});

Deno.test("parses account and legacy project metadata requests", () => {
  assertEquals(parseProtectedResourceMetadataProjectId(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource"),
  ), null);
  assertEquals(parseProtectedResourceMetadataProjectId(new URL(
    `https://abc.supabase.co/mcp/oauth-protected-resource?project_id=${projectId}`,
  )), projectId);
});

Deno.test("builds account and project protected-resource metadata", () => {
  assertEquals(buildProtectedResourceMetadata("https://abc.supabase.co/"), {
    resource: "https://abc.supabase.co/functions/v1/mcp",
    authorization_servers: ["https://abc.supabase.co/auth/v1"],
    bearer_methods_supported: ["header"],
  });
  assertEquals(buildProtectedResourceMetadata("https://abc.supabase.co", projectId), {
    resource: `https://abc.supabase.co/functions/v1/mcp/${projectId}`,
    authorization_servers: ["https://abc.supabase.co/auth/v1"],
    bearer_methods_supported: ["header"],
  });
});

Deno.test("builds account and project metadata URLs on Supabase", () => {
  assertEquals(buildProtectedResourceMetadataUrl("https://abc.supabase.co"),
    "https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource");
  assertEquals(buildProtectedResourceMetadataUrl("https://abc.supabase.co", projectId),
    `https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource?project_id=${projectId}`);
});

Deno.test("rejects malformed metadata queries", () => {
  for (const url of [
    "https://abc.supabase.co/mcp/oauth-protected-resource?",
    "https://abc.supabase.co/mcp/oauth-protected-resource?unknown=1",
    `https://abc.supabase.co/mcp/oauth-protected-resource?project_id=${projectId}&project_id=${projectId}`,
    "https://abc.supabase.co/mcp/oauth-protected-resource?project_id=not-a-project",
  ]) {
    assertThrows(() => parseProtectedResourceMetadataProjectId(new URL(url)),
      InvalidMcpMetadataRequestError);
  }
});

Deno.test("rejects malformed Supabase origins and project IDs", () => {
  for (const value of [undefined, "", "not-a-url", "ftp://abc.supabase.co",
    "https://abc.supabase.co/path", "https://abc.supabase.co?query=1",
    "https://user:pass@abc.supabase.co"]) {
    assertThrows(() => buildProtectedResourceMetadata(value),
      InvalidMcpMetadataConfigError);
  }
  assertThrows(
    () => buildProtectedResourceMetadata("https://abc.supabase.co", "not-a-project"),
    InvalidMcpMetadataRequestError,
  );
});
