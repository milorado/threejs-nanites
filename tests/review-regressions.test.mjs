// Inputs: synthetic models, cameras, timestamps and files. No production data/network.
// Invariants: all loading phases settle; camera uniforms use world space; profiling restores state;
// parsers reject invalid data; static requests stay inside their root. Fixtures are bounded and removed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

globalThis.location = { search: '' };
globalThis.document = { baseURI: 'https://example.invalid/' };
globalThis.matchMedia = () => ({ matches: false });
globalThis.window = new EventTarget();

const { loadModel } = await import('../src/nanite-lib/model/decode.ts');
for (const failure of ['constructor', 'postMessage', 'async', 'onerror', 'messageerror', 'url']) {
  test(`model loading settles every phase and cleans up: ${failure}`, async () => {
    let terminated = 0;
    globalThis.Worker = class {
      constructor() { if (failure === 'constructor') throw new Error('startup'); }
      terminate() { terminated++; }
      postMessage() {
        if (failure === 'postMessage') throw new Error('post');
        queueMicrotask(() => failure === 'onerror' ? this.onerror(new Event('error')) : failure === 'messageerror' ? this.onmessageerror() : this.onmessage({ data: { error: 'download failed' } }));
      }
    };
    const phases = loadModel(failure === 'url' ? 'http://[' : 'test.nm', 4);
    const result = await Promise.all(Object.values(phases).map((p) => assert.rejects(p)));
    assert.equal(result.length, 3);
    assert.equal(terminated, failure === 'constructor' ? 0 : 1);
  });
}
test('model loading preserves progressive success', async () => {
  const model = { dag: {}, src: {} }, header = { format: 'test' };
  globalThis.Worker = class {
    terminate() {}
    postMessage() { queueMicrotask(() => {
      this.onmessage({ data: { header } }); this.onmessage({ data: { coarse: model } }); this.onmessage({ data: model });
    }); }
  };
  const phases = loadModel('test.nm', 4);
  assert.deepEqual(await Promise.all([phases.header, phases.coarse, phases.model]), [header, model, model]);
});

test('camera rig world transform drives both LOD origins', async () => {
  const THREE = await import('three/webgpu');
  const { NaniteRenderer } = await import('../src/nanite-lib/gpu/renderer.ts');
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  rig.position.set(10000, 10, 20); rig.rotation.y = 0.5; camera.position.set(2, 2, 3); rig.add(camera);
  const view = () => ({ lodPos: { value: new THREE.Vector3() }, lodShift: new THREE.Vector3(), tauMul: { value: 1 }, impRetest: { value: 0 } });
  const fixture = {
    u: { time: { value: 0 }, prevTime: { value: 0 }, camPos: { value: new THREE.Vector3() }, projScale: { value: 0 } },
    main: view(), shadow: view(), mainGuard: { scale: 1, update() {} }, shadowGuard: { scale: 1, update() {} },
    sw: { begin() {} }, splats: { begin() {} }, willOcclude: () => false, _cull() {}, leafPrepass: { update() {} },
  };
  NaniteRenderer.prototype.update.call(fixture, camera, new THREE.Vector2(800, 800), 1);
  const expected = camera.getWorldPosition(new THREE.Vector3()).toArray();
  for (const v of [fixture.u.camPos, fixture.main.lodPos, fixture.shadow.lodPos]) assert.deepEqual(v.value.toArray(), expected);
});

for (const failAt of ['baseline', 'shadow map off', 'TAA off', 'upscaling off', 'god rays off', 'grass off', 'clouds off', 'terrain+sky off', 'tree draws off', 'half the pixels', null]) {
  test(`profiling restores settings after ${failAt ?? 'success'}`, async () => {
    const { runProfile } = await import('../src/profile.ts');
    let shadows = true, upscaled = true;
    const auto = { on: true, scale: 1 };
    const taa = { enabled: true }, rays = { enabled: true }, clouds = { visible: true }, grass = { visible: true }, terrain = [{ visible: true }], trees = { visible: true };
    const realTimer = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => realTimer(fn, ms === 10000 ? 20 : ms, ...args);
    try {
      const result = runProfile({ auto, taa, rays, clouds, grass, terrain, trees, shadowsOn: () => shadows, setShadows: (v) => (shadows = v), setScale: (s) => (auto.scale = s), upscale: { on: () => upscaled, set: (v) => (upscaled = v) } }, (label) => {
        if (label !== failAt) queueMicrotask(() => { for (let i = 0; i < 60; i++) auto.onSample(5, 1); });
      });
      if (failAt) await assert.rejects(result, /no GPU timings/);
      else assert.match(await result, /baseline/);
      assert.equal(shadows, true); assert.equal(auto.on, true); assert.equal(auto.onSample, undefined); assert.equal(auto.scale, 1);
      for (const item of [taa, rays]) assert.equal(item.enabled, true);
      for (const item of [clouds, grass, trees, ...terrain]) assert.equal(item.visible, true);
      assert.equal(upscaled, true);
    } finally { globalThis.setTimeout = realTimer; }
  });
}

const { readPly } = await import('../tools/model-input/ply.ts');
const ply = (props, values, faceProps = 'property list uchar int vertex_indices', faces = '3 0 1 2') => Buffer.from(`ply\nformat ascii 1.0\nelement vertex 3\n${props}\nelement face 1\n${faceProps}\nend_header\n${values}\n${faces}\n`);
const xyz = 'property float x\nproperty float y\nproperty float z';
test('PLY property names and variable list widths determine positions and faces', () => {
  const result = readPly(ply('property float z\nproperty list uchar float weights\nproperty float x\nproperty float y', '30 2 8 9 10 20\n31 0 11 21\n32 1 7 12 22', 'property uchar material_index\nproperty list uchar int vertex_indices', '0 3 0 1 2'));
  assert.deepEqual([...result.pos], [10,20,30,11,21,31,12,22,32]); assert.deepEqual([...result.idx], [0,1,2]);
  assert.deepEqual([...readPly(ply(xyz, '0 0 0\n1 0 0\n0 1 0')).idx], [0,1,2]);
});
test('PLY rejects empty, truncated and malformed input promptly', () => {
  for (const input of ['', 'ply\nend_header', 'ply\nformat ascii 1.0\nend_header garbage\n']) assert.throws(() => readPly(Buffer.from(input)), /PLY/);
  assert.throws(() => readPly(ply(xyz, '0 0 0\n1 0 0\n0 1 0', undefined, '4 0 1')), /list length/);
  assert.throws(() => readPly(ply(xyz, '0 0 0\n1 0 0\n0 1 0', undefined, '3 0 1 9')), /out of range/);
  assert.equal(readPly(Buffer.from(ply(xyz, '0 0 0\n1 0 0\n0 1 0').toString().replaceAll('\n', '\r\n'))).idx.length, 3);
});

test('static server confines files, handles malformed URIs and survives invalid requests', async () => {
  const { startStatic } = await import('../tools/harness/browser.ts');
  mkdirSync('tools/tmp', { recursive: true });
  const fixture = mkdtempSync(resolve('tools/tmp/static-test-')), dir = join(fixture, 'dist');
  mkdirSync(dir); mkdirSync(dir + '-adjacent');
  writeFileSync(join(dir, 'index.html'), 'public'); writeFileSync(join(dir + '-adjacent', 'canary'), 'outside');
  symlinkSync(join(dir + '-adjacent', 'canary'), join(dir, 'link'));
  let server;
  try {
    server = await startStatic(dir);
    for (const path of ['..%2fdist-adjacent/canary', '%ZZ', 'link']) assert.equal((await fetch(server.url + path)).status, 404);
    assert.equal(await (await fetch(server.url)).text(), 'public');
  } finally { await server?.close(); rmSync(fixture, { recursive: true, force: true }); }
});
