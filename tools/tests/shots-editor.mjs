import { chromium } from 'playwright';
// Screenshots of the editor (needs `npx vite --port 5174` running): node tools/tests/shots-editor.mjs <outdir> [base]
// Opens a weapon (ADS inset), its 3P view, an operator, the skeleton, the animation and the 1F plan; logs page errors.
const [OUT, BASE = 'http://localhost:5174'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 1500, height: 860 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.setDefaultTimeout(120000);
const shot = async (hash, name, after) => {
  await p.goto('about:blank');
  await p.goto(`${BASE}/editor/#${hash}`);
  await p.waitForSelector('#tree .file');
  await p.waitForTimeout(2500);
  if (after) { await after(); await p.waitForTimeout(4000); }
  await p.screenshot({ path: `${OUT}/editor_${name}.png` });
};
await shot('weapons/l85a2.json', 'weapon_ads');
await shot('weapons/l85a2.json', 'weapon_3p', () => p.click('#toolbar button:nth-child(4)'));
await shot('operators/thatcher.json', 'operator');
await shot('rig/skeleton.json', 'skeleton');
await shot('optics/holo.json', 'optic_holo');
await shot('maps/house/walls.json', 'plan_1f', async () => { await p.mouse.click(620, 430); });
await shot('maps/house/props.json', 'plan_b', async () => { await p.click('#toolbar button:nth-child(1)'); await p.mouse.click(700, 500); });
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
