import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Editor interaction checks (needs `npx vite --port 5174` running; writes data files, restore with git checkout data/):
// node tools/tests/editor-check.mjs [outdir]
const OUT = process.argv[2];
const BASE = 'http://localhost:5174';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 1500, height: 860 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.setDefaultTimeout(120000);
const open = async (hash) => { await p.goto('about:blank'); await p.goto(`${BASE}/editor/#${hash}`); await p.waitForSelector('#tree .file'); await p.waitForTimeout(2000); };
const step = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { console.log(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };

await step('weapon: a number typed in the inspector moves the anchor in the view (also when it is selected)', async () => {
  await open('weapons/l85a2.json');
  await p.click('#toolbar button:nth-child(3)'); // model + anchors
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.editor.view3d.select('muzzle'));
  // the muzzle's z field: the first input of the anchors' muzzle vec
  const before = await p.evaluate(() => window.editor.view3d.handles.get('muzzle').obj.position.z);
  const input = p.locator('aside .row:has(> label.k .key:text-is("muzzle"))').locator('.vec input').nth(2);
  await input.fill('-0.7');
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.editor.view3d.handles.get('muzzle').obj.position.z);
  assert.ok(Math.abs(after + 0.7) < 1e-6, `handle z ${before} → ${after}`);
  assert.match(await p.textContent('#status'), /저장 안 됨/);
});

await step('plan: clicking a wall selects it; its fields edit walls.json (marked unsaved), the plan follows', async () => {
  await open('maps/house/floors.json');
  await p.click('#toolbar button:nth-child(2)'); // 1F
  // the front-door wall (1F, run x at z −6.37): click on its line west of the door
  const box = await p.locator('#plan').boundingBox();
  const at = await p.evaluate(() => window.editor.views.plan.toScreen(-1.5, -6.37));
  await p.mouse.click(box.x + at.x, box.y + at.y);
  await p.waitForTimeout(400);
  const title = await p.textContent('aside h2');
  assert.match(title, /벽|문·창/, `selected: ${title}`);
  const where = await p.textContent('aside .path');
  assert.match(where, /walls\.json/);
  // its fixed coordinate, typed: the wall data follows and walls.json is unsaved
  const c = p.locator('aside .row:has(> label.k .key:text-is("c"))').locator('input').first();
  await c.fill('-6.5');
  await p.waitForTimeout(200);
  const v = await p.evaluate(() => window.editor.views.plan.item(window.editor.views.plan.sel).c);
  assert.equal(v, -6.5);
  assert.ok(await p.evaluate(() => [...document.querySelectorAll('#tree .file.dirty')].some((e) => e.dataset.path === 'maps/house/walls.json')), 'walls.json marked unsaved');
});

await step('plan: a floor on 2F shows corner handles; dragging one resizes the rect; the inspector shows the new value', async () => {
  await open('maps/house/floors.json');
  await p.click('#toolbar button:nth-child(3)'); // 2F
  await p.waitForTimeout(300);
  // hide every layer but floors so the click lands on a floor
  await p.evaluate(() => { for (const row of document.querySelectorAll('.layers div')) { const t = row.textContent; const cb = row.querySelectorAll('input'); if (cb.length && !t.includes('바닥') ) { cb[0].checked = false; cb[0].dispatchEvent(new Event('change')); } if (cb.length && t.includes('바닥 구멍')) { cb[0].checked = false; cb[0].dispatchEvent(new Event('change')); } } });
  const box = await p.locator('#plan').boundingBox();
  await p.mouse.click(box.x + box.width / 2 + 3 * 28, box.y + box.height / 2 + 2 * 28);
  await p.waitForTimeout(300);
  assert.match(await p.textContent('aside h2'), /바닥/);
  const r0 = await p.evaluate(() => { const s = window.editor.views.plan.sel; return JSON.parse(JSON.stringify(window.editor.views.plan.item(s).rect)); });
  // the north-east corner handle
  const n = { x0: Math.min(r0.x0, r0.x1), x1: Math.max(r0.x0, r0.x1), z0: Math.min(r0.z0, r0.z1) };
  const hx = box.x + box.width / 2 + n.x1 * 28, hz = box.y + box.height / 2 + n.z0 * 28;
  await p.mouse.move(hx, hz); await p.mouse.down(); await p.mouse.move(hx + 28, hz - 28, { steps: 6 }); await p.mouse.up();
  await p.waitForTimeout(300);
  const r1 = await p.evaluate(() => { const s = window.editor.views.plan.sel; return JSON.parse(JSON.stringify(window.editor.views.plan.item(s).rect)); });
  assert.ok(Math.abs(Math.max(r1.x0, r1.x1) - (n.x1 + 1)) < 0.06 && Math.abs(Math.min(r1.z0, r1.z1) - (n.z0 - 1)) < 0.06, `rect ${JSON.stringify(r0)} → ${JSON.stringify(r1)}`);
  if (OUT) await p.screenshot({ path: `${OUT}/editor_plan_resize.png` });
});

await step('save writes the file on disk (the format the repository uses)', async () => {
  await open('rig/viewmodel.json');
  const input = p.locator('aside .row', { hasText: 'hipFov' }).locator('input').first();
  await input.fill('59');
  await p.keyboard.press('Control+s');
  await p.waitForFunction(() => /저장했습니다/.test(document.querySelector('#status').textContent));
  const disk = JSON.parse(readFileSync('data/rig/viewmodel.json', 'utf8'));
  assert.equal(disk.hipFov, 59);
  console.log('   ', await p.textContent('#status'));
});

if (OUT) { await open('weapons/l85a2.json'); await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/editor_weapon_gizmo.png` }); }
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
