# Review regression tests

Run from the repository root with Node 24+ and locked dependencies (`npm ci`).

- `npm test`: synthetic unit/integration regressions; requires loopback port 5299 for the static-server test.
- `npm run test:browser`: launches a local Vite server and installed Chromium/Chrome/Edge with WebGPU. Tests native scene-button Enter activation, reads actual GPU cluster IDs at 65,535/65,536/65,537/70,000 candidates in both main and shadow views, and boots the WebGL fallback for adapters with 8/9 storage buffers and rejected adapter requests.
- `npm run build`: strict application/tools type checks, library import-boundary check and production Vite bundle.
- `npm run harness -- --dist --example --size=640x360 --timeout=90`: standalone rendering smoke and screenshot.

Run browser tests and visual harnesses sequentially: they share GPU and temporary browser directories. The static-server test and `--dist` harness also share port 5299. Tests use synthetic fixtures under `tools/tmp`, remove them after use, and do not change production assets. Screenshots/logs go to ignored `tools/out`.

Coverage maps to review findings MILORADO-THREEJS-NANITES-F001 through F009:

| Finding | Regression |
|---|---|
| F001 unsupported-adapter routing | Real browser boots WebGL for limits 8/9 and adapter rejection; normal WebGPU checked by the visual harness |
| F002 truncated cluster work items | GPU readback checks count, unique IDs and maximum ID across the 16-bit boundary, main and shadow |
| F003 camera rigs | Translated/rotated parent with initially stale matrices; uniform and both LOD origins match world position |
| F004 progressive loader failure | Constructor, URL, postMessage, worker error/message error/error result; all promises reject and worker terminates; successful progression retained |
| F005 profiling cleanup | Timeout at each supported non-forest step and successful completion restore settings |
| F006 PLY property order | Reordered/interleaved coordinates and variable-length lists; scalar face property before indices; conventional control |
| F007 truncated PLY | Empty/missing newline/invalid header, malformed lists, invalid index and valid CRLF control |
| F008 keyboard activation | Native browser Enter on focused Lucy button |
| F009 static root/URI handling | Encoded sibling traversal, symlink escape, malformed percent escape, then valid request proving server survives |

The GPU fixture intentionally repeats one triangle across many clusters to isolate dispatch completeness; it is not a visual LOD-quality or performance benchmark. Profiler timeout tests accelerate its 10-second watchdog. No mobile hardware, Safari, full-density Lucy or long-term memory certification is implied.
