/**
 * Dev-server API for the editor (`npm run editor` → /editor/): reads and writes the data files and hand-made models on
 * disk. Only in `vite` serve mode — nothing of it is in a build.
 *
 *   GET  /__editor/files            every data/**\/*.json (raw, with $schema) and every schema, keyed by path under data/
 *   PUT  /__editor/data/<path>      write one data file (JSON body; written in the data format, src/data/format.ts)
 *   PUT  /__editor/model/<name>     write a GLB to public/assets/models/handmade/<name> (binary body)
 *   GET  /__editor/models           the hand-made GLBs on disk
 *
 * A saved data file does not hot-reload the editor (it holds the edited state); open game tabs reload instead
 * (`r6:data` event, handled in src/main.ts).
 */
import type { Plugin, ViteDevServer } from 'vite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatJson } from '../../src/data/format.ts';

// (fileURLToPath, not URL.pathname: on Windows the pathname is "/C:/…", which resolves to a path that doesn't exist)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = join(ROOT, 'data');
const HANDMADE = join(ROOT, 'public/assets/models/handmade');

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []));
const inside = (base: string, p: string) => { const r = resolve(base, p); return r.startsWith(base + sep) ? r : null; };
const body = (req: import('node:http').IncomingMessage) => new Promise<Buffer>((ok, fail) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', fail); });

export function editorApi(): Plugin {
  let server: ViteDevServer;
  const selfWrites = new Set<string>();
  return {
    name: 'r6-editor-api',
    apply: 'serve',
    configureServer(s) {
      server = s;
      s.middlewares.use(async (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!url.startsWith('/__editor/')) return next();
        const send = (code: number, v: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
        try {
          if (req.method === 'GET' && url === '/__editor/files') {
            const files = Object.fromEntries(walk(DATA).map((f) => [relative(DATA, f).split(sep).join('/'), JSON.parse(readFileSync(f, 'utf8'))]));
            return send(200, { files });
          }
          if (req.method === 'GET' && url === '/__editor/models') {
            mkdirSync(HANDMADE, { recursive: true });
            return send(200, { models: readdirSync(HANDMADE).filter((f) => f.endsWith('.glb')).map((f) => `handmade/${f}`) });
          }
          if (req.method === 'PUT' && url.startsWith('/__editor/data/')) {
            const p = url.slice('/__editor/data/'.length);
            const file = p.endsWith('.json') && !p.startsWith('schema/') ? inside(DATA, p) : null;
            if (!file) return send(400, { error: `not a data file: ${p}` });
            const json = JSON.parse((await body(req)).toString('utf8'));
            mkdirSync(dirname(file), { recursive: true });
            selfWrites.add(file);
            writeFileSync(file, formatJson(json));
            server.ws.send({ type: 'custom', event: 'r6:data', data: { path: p } });
            return send(200, { ok: true, path: p, file });
          }
          if (req.method === 'PUT' && url.startsWith('/__editor/model/')) {
            const name = url.slice('/__editor/model/'.length);
            const file = /^[\w.-]+\.glb$/.test(name) ? inside(HANDMADE, name) : null;
            if (!file) return send(400, { error: `bad model name: ${name}` });
            const buf = await body(req);
            if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) return send(400, { error: 'not a GLB (glTF binary)' });
            mkdirSync(HANDMADE, { recursive: true });
            writeFileSync(file, buf);
            return send(200, { ok: true, glb: `handmade/${name}`, bytes: buf.length });
          }
          return send(404, { error: 'unknown editor call' });
        } catch (e) {
          return send(500, { error: String(e) });
        }
      });
    },
    // data files: no module hot update (the editor keeps its state); game tabs reload on the r6:data event
    handleHotUpdate(ctx) {
      // (Vite reports forward slashes on every OS)
      const file = resolve(ctx.file);
      if (file.startsWith(DATA + sep)) {
        if (!selfWrites.delete(file)) server.ws.send({ type: 'custom', event: 'r6:data', data: { path: relative(DATA, file).split(sep).join('/') } });
        return [];
      }
    },
  };
}
