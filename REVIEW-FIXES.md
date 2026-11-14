# Review fixes

Baseline: `500113d7b651d2eb96392ce87c96330bdec25e15` on fork main. Local branch: `codex/fix-review-findings`.

All nine findings from the 2026-11-07 review are addressed:

- F001: unsupported storage-buffer capabilities and rejected adapter requests use the existing warning/Continue WebGL route. The WebGPU guard remains in place.
- F002: culling work items carry full-width instance, offset and count fields, avoiding 16-bit truncation for dense imported meshes. Three uvec4 item buffers now consume 48 MiB instead of 24 MiB in total; storage binding count is unchanged.
- F003: camera and LOD positions come from the updated camera world transform.
- F004: synchronous/asynchronous model-worker failures reject every pending phase and terminate any created worker.
- F005: each profiling measurement restores its feature in a finally block, including sampling failure.
- F006/F007: ASCII PLY walks declared scalar/list properties, validates positions and face indices, and rejects missing/truncated headers without an unbounded scan.
- F008: focused scene buttons retain native Enter activation.
- F009: local static server checks exact resolved root containment, including symlink targets, and catches malformed URI decoding.

Validation: `npm test` passes 22 tests; `npm run typecheck` and `npm run build` pass. Browser regressions pass for native keyboard input, actual GPU IDs at four boundary sizes in both views, and working WebGL fallbacks for limits 8/9 and rejected adapter requests. The production-build standalone 250,000-rock example renders successfully and its screenshot was visually checked. The production-build reduced forest smoke also passes (1,000 requested trees, 640×360, ten frames), with screenshot inspected. The existing TSL inline-Fn warning and Vite large-chunk warning remain.

See [tests/README.md](tests/README.md) for commands, coverage and limitations. Upstream synchronization is separate from these fixes. Deployment is outside the scope of this change.
