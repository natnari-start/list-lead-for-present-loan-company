import { db } from '@appdeploy/sdk';

const TABLE = 'sheets_read_cache_v1';
const TTL = 45000;
const CHUNK_BYTES = 160000;
const MAX_CHUNKS = 64;
type State = { epoch: string; lease?: string; leaseUntil?: number; version?: string; count?: number; until?: number };
type Chunk = { version: string; text: string };

// Cache is app-isolated. Only authenticated routes call it. Sheets remains authoritative.
async function state(key: string): Promise<State> {
  let [current] = await db.get<State>(TABLE, [key], { consistent: true });
  if (!current) {
    await db.tx.add(TABLE, [{ id: key, epoch: crypto.randomUUID() }]);
    [current] = await db.get<State>(TABLE, [key], { consistent: true });
  }
  if (!current) throw new Error('เตรียม cache ไม่สำเร็จ กรุณาลองใหม่');
  return current;
}
export async function invalidateSharedSheetsCache(key: string): Promise<void> {
  await state(key);
  const [ok] = await db.tx.update(TABLE, [{ id: key, record: {
    epoch: crypto.randomUUID(), lease: undefined, leaseUntil: 0, version: undefined, count: 0, until: 0,
  } }], { patch: true });
  if (!ok) throw new Error('ล้าง cache ไม่สำเร็จ กรุณาลองใหม่');
}

export async function sharedSheetsRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await state(key);
    if (current.version && (current.until || 0) > Date.now() && current.count && current.count <= MAX_CHUNKS) {
      const ids = Array.from({ length: current.count }, (_, i) => key + '_chunk_' + i);
      // Bounded groups keep each response below 1 MiB.
      const chunks: Array<Chunk | null> = [];
      for (let i = 0; i < ids.length; i += 4) chunks.push(...await db.get<Chunk>(TABLE, ids.slice(i, i + 4), { consistent: true }));
      const latest = await state(key);
      if (latest.epoch === current.epoch && latest.version === current.version &&
          chunks.every(chunk => chunk?.version === current.version)) {
        return JSON.parse(chunks.map(chunk => chunk!.text).join('')) as T;
      }
      continue;
    }
    if (current.lease && (current.leaseUntil || 0) > Date.now()) {
      await new Promise(resolve => setTimeout(resolve, 250));
      continue;
    }
    const lease = crypto.randomUUID();
    const [acquired] = await db.tx.update(TABLE, [{ id: key,
      record: { lease, leaseUntil: Date.now() + 60000 },
      if: { epoch: current.epoch, lease: current.lease },
    }], { patch: true });
    if (!acquired) continue;
    try {
      const value = await loader();
      const version = crypto.randomUUID();
      const serialized = JSON.stringify(value);
      const chunks: string[] = [];
      let chunk = '', bytes = 0;
      for (const character of serialized) {
        const size = new TextEncoder().encode(character).length;
        if (bytes + size > CHUNK_BYTES) { chunks.push(chunk); chunk = ''; bytes = 0; }
        chunk += character; bytes += size;
      }
      if (chunk) chunks.push(chunk);
      if (chunks.length <= MAX_CHUNKS) {
        for (let i = 0; i < chunks.length; i++) {
          const [ok] = await db.tx.update(TABLE, [{ id: key + '_chunk_' + i, record: { version, text: chunks[i] } }]);
          if (!ok) throw new Error('เขียน cache ไม่สำเร็จ');
        }
        await db.tx.update(TABLE, [{ id: key, record: {
          version, count: chunks.length, until: Date.now() + TTL, lease: undefined, leaseUntil: 0,
        }, if: { epoch: current.epoch, lease } }], { patch: true });
      }
      return value;
    } finally {
      // A failed or stale loader must not release another worker's lease.
      await db.tx.update(TABLE, [{ id: key, record: { lease: undefined, leaseUntil: 0 },
        if: { epoch: current.epoch, lease } }], { patch: true });
    }
  }
  throw new Error('กำลังโหลดข้อมูล Google Sheets กรุณาลองเชื่อมต่อใหม่อีกครั้ง');
}
