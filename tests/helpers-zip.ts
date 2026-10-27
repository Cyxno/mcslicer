const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a minimal zip (stored or deflate-raw entries) for tests. */
export async function makeZip(entries: [string, Uint8Array][]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number): Uint8Array =>
    new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

  for (const [name, bytes] of entries) {
    let data = bytes;
    let method = 0;
    if ('CompressionStream' in globalThis && bytes.length > 0) {
      // deflate-raw when the platform supports it (exercises method 8).
      const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
        .stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
      method = 8;
    }
    const nameBytes = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    local.set(u32(0x04034b50), 0);
    local.set(u16(method), 8);
    local.set(u32(crc32(bytes)), 14);
    local.set(u32(data.length), 18);
    local.set(u16(nameBytes.length), 26);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const centralName = new Uint8Array(46 + nameBytes.length);
    centralName.set(u32(0x02014b50), 0);
    centralName.set(u16(method), 10);
    centralName.set(u32(crc32(bytes)), 16);
    centralName.set(u32(data.length), 20);
    centralName.set(u16(nameBytes.length), 28);
    centralName.set(u32(offset), 42);
    centralName.set(nameBytes, 46);
    central.push(centralName);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  eocd.set(u32(0x06054b50), 0);
  eocd.set(u16(entries.length), 10);
  eocd.set(u32(centralSize), 12);
  eocd.set(u32(offset), 16);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of all) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
