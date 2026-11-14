// Vite resolves the same three.js/TSL module instances used by the production renderer.
import * as THREE from 'three/webgpu';
export { THREE };
export { float } from 'three/tsl';
export { NaniteRenderer } from '../src/nanite-lib/gpu/renderer.ts';
export { ARGS } from '../src/nanite-lib/gpu/constants.ts';
