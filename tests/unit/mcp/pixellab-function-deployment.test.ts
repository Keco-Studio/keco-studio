import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github/workflows/deploy-vercel.yml"),
  "utf8",
);

function workflowJob(name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = start + marker.length;
  const nextJob = workflow.slice(bodyStart).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return workflow.slice(
    start,
    nextJob === -1 ? undefined : bodyStart + nextJob,
  );
}

describe("production paid-generation Edge Function deployment", () => {
  it("deploys both PixelLab providers before the MCP function", () => {
    const productionJob = workflowJob("deploy-mcp-function");
    const commands = [
      'supabase functions deploy pixellab-map --no-verify-jwt --project-ref "$PROJECT_REF"',
      'supabase functions deploy pixellab-character --no-verify-jwt --project-ref "$PROJECT_REF"',
      'supabase functions deploy mcp --no-verify-jwt --project-ref "$PROJECT_REF"',
    ];

    expect(productionJob).toContain("github.event_name == 'push'");
    expect(productionJob).toMatch(
      /github\.ref == 'refs\/heads\/(?:main|master)'/,
    );

    const executableLines = productionJob
      .split("\n")
      .map((line) => line.trim());
    for (const command of commands) {
      expect(executableLines.filter((line) => line === command)).toHaveLength(
        1,
      );
    }

    expect(executableLines.indexOf(commands[0])).toBeLessThan(
      executableLines.indexOf(commands[2]),
    );
    expect(executableLines.indexOf(commands[1])).toBeLessThan(
      executableLines.indexOf(commands[2]),
    );
  });
});
