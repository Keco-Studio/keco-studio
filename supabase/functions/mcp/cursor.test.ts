import { assertEquals, assertRejects } from "@std/assert";
import { CURSOR_TTL_MS, decodeCursor, encodeCursor } from "./cursor.ts";
import { McpDomainError } from "./errors.ts";

const binding = {
  kind: "table_rows",
  projectId: "11111111-1111-4111-8111-111111111111",
  objectId: "table-1",
};
const secret = "cursor-secret-long-enough-for-tests";

Deno.test("cursor round trips an operation-bound position", async () => {
  const cursor = await encodeCursor(binding, { rowIndex: 3, id: "row-3" }, secret, 1000);
  assertEquals(
    await decodeCursor(cursor, binding, secret, 1001),
    { rowIndex: 3, id: "row-3" },
  );
});

Deno.test("cursor rejects tampering, expiry, and binding changes", async () => {
  const cursor = await encodeCursor(binding, { id: "row-3" }, secret, 1000);
  const attempts: Array<() => Promise<unknown>> = [
    () => decodeCursor(cursor.slice(0, -1) + "A", binding, secret, 1001),
    () => decodeCursor(cursor, binding, secret, 1000 + CURSOR_TTL_MS),
    () => decodeCursor(cursor, { ...binding, kind: "documents" }, secret, 1001),
    () => decodeCursor(cursor, { ...binding, projectId: "other" }, secret, 1001),
    () => decodeCursor(cursor, { ...binding, objectId: "other" }, secret, 1001),
  ];
  for (const attempt of attempts) {
    const error = await assertRejects(attempt, McpDomainError);
    assertEquals(error.code, "INVALID_CURSOR");
  }
});
