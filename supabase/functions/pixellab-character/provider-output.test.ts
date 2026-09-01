import { assertEquals } from "@std/assert";
import { decode, encode } from "fast-png";
import { downloadProviderOutput } from "./provider-output.ts";

function frame(red: number): Uint8Array {
  return encode({ width: 2, height: 1, channels: 4, depth: 8, data: new Uint8Array([
    red, 0, 0, 255, red, 1, 0, 0,
  ]) });
}

Deno.test("downloads a provider spritesheet as one bounded PNG", async () => {
  const bytes = frame(10);
  const result = await downloadProviderOutput({ imageUrl: "https://cdn.example.test/sheet.png", frameUrls: [] },
    async () => new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "image/png" } }));
  assertEquals(result, bytes);
});

Deno.test("packs separate provider frames left-to-right when no spritesheet exists", async () => {
  const frames = [frame(10), frame(20), frame(30)];
  const result = await downloadProviderOutput({ imageUrl: null, frameUrls: ["https://cdn.example.test/1.png", "https://cdn.example.test/2.png", "https://cdn.example.test/3.png"] },
    async (url: string | URL | Request) => new Response(
      frames[Number(String(url).match(/(\d)\.png$/)?.[1]) - 1].slice().buffer as ArrayBuffer,
      { status: 200 },
    ));
  const image = decode(result);
  assertEquals({ width: image.width, height: image.height }, { width: 6, height: 1 });
  assertEquals(Array.from(image.data).filter((_value, index) => index % 4 === 0), [10, 10, 20, 20, 30, 30]);
});

Deno.test("decodes a bounded data URL spritesheet without network access", async () => {
  const bytes = await downloadProviderOutput({ imageUrl: "data:image/png;base64,AAECAwQ=", frameUrls: [] }, async () => { throw new Error("network must not be used for data URLs"); });
  assertEquals([...bytes], [0, 1, 2, 3, 4]);
});
