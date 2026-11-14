// Inputs: synthetic adapter limits, native keyboard events and a one-instance cluster DAG.
// Invariants: unsupported hardware gets the fallback; every selected cluster ID survives dispatch.
// Output: assertion results/screenshots. Failures: browser/GPU unavailable or 90s watchdog aborts visibly.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { startServer, launchBrowser, useProjectTemp } from '../tools/harness/browser.ts';
const root = process.cwd();
useProjectTemp(root);
const timeout = setTimeout(() => { console.error('Browser regression timeout'); process.exit(1); }, 90000);
const server = await startServer(root);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/regression-fixture', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Regression fixture</title>' }));
  await page.goto(server.url + 'regression-fixture');
  await page.setContent('<div data-scene-choice><p data-scene-countdown></p><button data-scene="forest"><i></i>Forest</button><button data-scene="lucy">Lucy</button></div>');
  await page.evaluate(async () => {
    const { chooseScene } = await import('/src/scene.ts');
    window.selection = chooseScene(new URLSearchParams(), false).scene;
  });
  await page.locator('[data-scene=lucy]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.selection), 'lucy');
  console.log('PASS: native Enter selects focused Lucy button');

  const counts = await page.evaluate(async () => {
    const { THREE, float, NaniteRenderer, ARGS } = await import('/tests/browser-fixture.js');
    const r = new THREE.WebGPURenderer(); await r.init();
    const n = 70000, rec = new Float32Array(n * 16), meta = new Uint32Array(n * 4);
    for (let i = 0; i < n; i++) {
      rec.set([0,0,0,1, 0,0,0,1, 0,0,0,1, 0,1000,0,0], i * 16);
      meta.set([0,1,0,0], i * 4);
    }
    const type = { id: 0, name: 'boundary', height: 1, radius: 2, rec, meta, idx: new Uint32Array([0,1,2]), vtx: new Float32Array([0,0,0,0,0,1,0,0, 1,0,0,0,0,1,0,0, 0,1,0,0,0,1,0,0]), stats: {} };
    const tex = new THREE.DataArrayTexture(new Uint8Array([255,255,255,255]),1,1,1);
    tex.needsUpdate = true; tex.userData.levels = 1; tex.userData.alphaScales = [1];
    const f = new NaniteRenderer(r, [type], { a: new Float32Array([0,0,0,1]), b: new Float32Array([1,0,0,0]), firstModel: 0 }, { bark: tex, leaf: tex, barkLayerOf: () => float(0), leafLayerOf: () => float(0), alphaToCoverage: false, leafDither: false });
    f.chunks.maxHeight = 0; f.u.occlusion.value = 0; f.occlusionOn = false; f.u.impostorPx.value = 0;
    const camera = new THREE.PerspectiveCamera(60,1,0.1,100); camera.position.set(0,0,10);
    const results = [];
    for (const count of [65535,65536,65537,70000]) {
      f.typeValues[0].y = count; f.typeInfo.needsUpdate = true;
      f.update(camera, new THREE.Vector2(640,360), 0, camera);
      for (const view of [f.main, f.shadow]) {
        const ctr = new Uint32Array(await r.getArrayBufferAsync(view.ctr.attr));
        const actual = ctr[view.sets[0].base + ARGS.bark + 1];
        const list = new Uint32Array(await r.getArrayBufferAsync(view.sets[0].listAttr));
        const ids = new Set(); for (let i=0;i<actual;i++) ids.add(list[i*2+1]);
        results.push({ count, view: view === f.main ? 'main' : 'shadow', actual, unique: ids.size, max: Math.max(...ids) });
      }
    }
    r.dispose(); return results;
  });
  for (const row of counts) { assert.equal(row.actual,row.count); assert.equal(row.unique,row.count); assert.equal(row.max,row.count-1); }
  console.log('PASS: real GPU cluster IDs at all boundaries in main and shadow views', counts);
  assert.deepEqual(errors, []);
  await page.close();
  for (const mode of ['8','9','reject']) {
    const fallback = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await fallback.addInitScript((mode) => Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: () => mode === 'reject' ? Promise.reject(new Error('blocked')) : Promise.resolve({ limits: { maxStorageBuffersPerShaderStage: Number(mode) } }) } }), mode);
    await fallback.goto(server.url + '?harness=1&scene=forest&trees=1000&bushes=0&plaza=0&grass=0');
    await fallback.waitForFunction(() => window.__demo?.ready || window.__demo?.error, { timeout: 45000 });
    const state = await fallback.evaluate(() => ({ ready: window.__demo.ready, error: window.__demo.error, backend: window.__demo.info?.().backend }));
    assert.equal(state.error, null); assert.equal(state.ready, true);
    mkdirSync('tools/out', { recursive: true });
    await fallback.screenshot({ path: `tools/out/fallback-${mode}.png` });
    console.log('PASS: unsupported adapter uses working fallback', mode, state);
    await fallback.close();
  }
} finally { clearTimeout(timeout); await browser?.close(); await server.close(); }
