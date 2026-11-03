/** Serve a built Conversation preview and its real shot-generation endpoint on loopback. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';

async function main() {
  const directory = process.argv[2];
  if (!directory)
    throw new Error('Pass the directory containing the built preview.');
  loadEnvConfig(process.cwd(), true);
  const { generateShotResponse } =
    await import('../src/lib/server/shotGeneration');
  const port = Number(process.env.KECO_PREVIEW_PORT || 3187);
  const host = '127.0.0.1:' + port;
  let busy = false;
  const files: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html'],
    '/main.js': ['main.js', 'application/javascript'],
    '/main.css': ['main.css', 'text/css'],
  };
  createServer(async (req, res) => {
    const reply = (status: number, error: string) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error }));
    };
    if (req.headers.host !== host) return reply(403, '本地地址无效');
    const path = new URL(req.url || '/', 'http://' + host).pathname;
    if (path === '/api/script-shot-generation' && req.method === 'POST') {
      if (
        req.headers.origin !== 'http://' + host ||
        !req.headers['content-type']?.includes('application/json')
      )
        return reply(403, '只接受当前预览页请求');
      if (busy) return reply(429, '已有镜头正在生成');
      busy = true;
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 150000) return reply(413, '镜头请求过大');
          chunks.push(Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof body.brief !== 'string' || body.brief.length > 1000)
          return reply(400, '导演要求格式无效');
        const response = await generateShotResponse(
          body,
          AbortSignal.timeout(120000),
        );
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(await response.text());
      } catch {
        return reply(400, '请求无效或已超时');
      } finally {
        busy = false;
      }
      return;
    }
    const file = files[path];
    if (req.method !== 'GET' || !file) return reply(404, '未找到接口');
    try {
      const bytes = await readFile(resolve(directory, file[0]));
      res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8' });
      res.end(bytes);
    } catch {
      return reply(404, '预览文件不存在');
    }
  }).listen(port, '127.0.0.1', () =>
    console.log('Conversation preview: http://' + host),
  );
}
void main();
