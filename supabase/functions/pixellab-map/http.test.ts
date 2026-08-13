import { assertEquals } from "@std/assert";
import { jsonResponse } from "./http.ts";

Deno.test("returns an empty body for status codes that forbid response bodies", async () => {
  const response = jsonResponse({}, 204);

  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
});
