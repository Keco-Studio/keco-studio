import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

describe("character animation MCP documentation", () => {
  it("documents all tools, live PixelLab operations, separate confirmations, and guarded acceptance", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), "docs/mcp/README.md"), "utf8");
    for (const tool of ["list_character_assets", "read_character_asset", "create_character_asset_draft", "update_character_asset_draft", "prepare_character_asset_generation", "start_character_asset_generation", "get_character_asset_generation", "advance_character_asset_generation"]) expect(readme).toContain(`\`${tool}\``);
    expect(readme).toMatch(/create_character[\s\S]*pro mode[\s\S]*animate_character[\s\S]*V3/i);
    expect(readme).toMatch(/character ID[\s\S]*identity anchor[\s\S]*horizontal spritesheet/i);
    expect(readme).toMatch(/each stage[\s\S]*fee notice[\s\S]*explicit confirmation/i);
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/accept-character-animation-paid.ts"), "utf8");
    expect(script).toMatch(/KECO_ACCEPTANCE_CHARACTER_ANIMATION.*true/);
    expect(script).toMatch(/KECO_ACCEPTANCE_CONFIRM_PAID.*true/);
    expect(script).toMatch(/prepare_character_asset_generation[\s\S]*start_character_asset_generation/i);
  });
});
