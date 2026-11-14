// Reads a PLY (binary either endianness, or ASCII; triangles or polygons): its vertex positions and triangles.

interface PlyProp {
  name: string;
  type: string;
  list?: boolean;
  count?: string; // (a list's length type)
}
interface PlyElement {
  name: string;
  count: number;
  props: PlyProp[];
}

export function readPly(buf: Buffer): { pos: Float32Array; idx: Uint32Array } {
  const headEnd = buf.indexOf('end_header');
  if (headEnd < 0) throw new Error('PLY header is missing end_header');
  const header = buf.subarray(0, headEnd).toString('latin1').split(/\r?\n/);
  let body = headEnd + 'end_header'.length;
  const newline = buf.indexOf(0x0a, body);
  if (newline < 0 || !/^\r?$/.test(buf.subarray(body, newline).toString('latin1'))) throw new Error('PLY header is truncated');
  body = newline + 1;
  const format = header.find((l) => l.startsWith('format'))?.split(' ')[1];
  if (header[0]?.trim() !== 'ply' || !['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format ?? '')) throw new Error('unsupported PLY format');
  const elements: PlyElement[] = [];
  for (const l of header) {
    const w = l.trim().split(/\s+/);
    if (w[0] === 'element') elements.push({ name: w[1], count: Number(w[2]), props: [] });
    else if (w[0] === 'property') elements.at(-1)?.props.push(w[1] === 'list' ? { list: true, count: w[2], type: w[3], name: w[4] } : { type: w[1], name: w[2] });
  }
  const size: Record<string, number> = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const le = format === 'binary_little_endian';
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const read = (t: string, o: number): number => {
    switch (t) {
      case 'char': case 'int8': return dv.getInt8(o);
      case 'uchar': case 'uint8': return dv.getUint8(o);
      case 'short': case 'int16': return dv.getInt16(o, le);
      case 'ushort': case 'uint16': return dv.getUint16(o, le);
      case 'int': case 'int32': return dv.getInt32(o, le);
      case 'uint': case 'uint32': return dv.getUint32(o, le);
      case 'float': case 'float32': return dv.getFloat32(o, le);
      default: return dv.getFloat64(o, le);
    }
  };
  let pos: Float32Array | null = null;
  if (format === 'ascii') {
    const idx: number[] = [];
    const lines = buf.subarray(body).toString('latin1').split(/\r?\n/);
    let li = 0;
    for (const el of elements) {
      if (!Number.isSafeInteger(el.count) || el.count < 0 || el.count > lines.length) throw new Error('invalid PLY element count');
      if (el.name === 'vertex') {
        if (!['x', 'y', 'z'].every((name) => el.props.some((p) => p.name === name && !p.list))) throw new Error('PLY vertices need x, y, z');
        pos = new Float32Array(el.count * 3);
      }
      for (let i = 0; i < el.count; i++) {
        const line = lines[li++];
        if (!line?.trim()) throw new Error('PLY body is truncated');
        const w = line.trim().split(/\s+/).map(Number);
        let at = 0;
        for (const p of el.props) {
          if (p.list) {
            const count = w[at++];
            if (!Number.isSafeInteger(count) || count < 0 || count > w.length - at) throw new Error('invalid PLY list length');
            if (el.name === 'face' && (p.name === 'vertex_indices' || p.name === 'vertex_index')) {
              for (let k = 0; k < count; k++) if (!Number.isSafeInteger(w[at + k]) || w[at + k] < 0) throw new Error('invalid PLY vertex index');
              for (let k = 1; k + 1 < count; k++) idx.push(w[at], w[at + k], w[at + k + 1]);
            }
            at += count;
          } else {
            const value = w[at++];
            if (!Number.isFinite(value)) throw new Error('invalid PLY scalar');
            const axis = ['x', 'y', 'z'].indexOf(p.name);
            if (el.name === 'vertex' && axis >= 0) pos![i * 3 + axis] = value;
          }
        }
        if (at !== w.length) throw new Error('PLY row does not match its properties');
      }
    }
    if (!pos) throw new Error('no vertices');
    if (idx.some((i) => i >= pos!.length / 3)) throw new Error('PLY vertex index out of range');
    return { pos, idx: Uint32Array.from(idx) };
  }
  let o = body, idx = new Uint32Array(0);
  for (const el of elements) {
    if (el.name === 'vertex') {
      pos = new Float32Array(el.count * 3);
      const offs: Record<string, { o: number; t: string }> = {}; let stride = 0;
      for (const p of el.props) { offs[p.name] = { o: stride, t: p.type }; stride += size[p.type]; }
      for (let i = 0; i < el.count; i++, o += stride) {
        pos[i * 3] = read(offs.x.t, o + offs.x.o); pos[i * 3 + 1] = read(offs.y.t, o + offs.y.o); pos[i * 3 + 2] = read(offs.z.t, o + offs.z.o);
      }
    } else if (el.name === 'face') {
      const out = new Uint32Array(el.count * 3);
      let n = 0, grow = out;
      for (let i = 0; i < el.count; i++) {
        for (const p of el.props) {
          if (!p.list) { o += size[p.type]; continue; }
          const ct = p.count ?? 'uchar';
          const c = read(ct, o); o += size[ct];
          const first = read(p.type, o), vs: number[] = [];
          for (let k = 0; k < c; k++) { vs.push(read(p.type, o)); o += size[p.type]; }
          if (p.name !== 'vertex_indices' && p.name !== 'vertex_index') continue;
          for (let k = 1; k + 1 < c; k++) {
            if (n + 3 > grow.length) { const g = new Uint32Array(grow.length * 2); g.set(grow); grow = g; }
            grow[n++] = first; grow[n++] = vs[k]; grow[n++] = vs[k + 1];
          }
        }
      }
      idx = grow.subarray(0, n);
    } else {
      throw new Error(`binary PLY element "${el.name}" before the faces isn't supported`);
    }
  }
  if (!pos) throw new Error('no vertices');
  return { pos, idx };
}
