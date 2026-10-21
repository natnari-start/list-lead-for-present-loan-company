import {
  db,
  error,
  json,
  requireAdminEmailAllowlist,
  type RouterMiddleware,
  requireAuth,
  router,
} from '@appdeploy/sdk';
import { schemas } from '../src/schema';

const PARTS = ['customers', 'cases', 'contacts', 'tasks', 'documents'] as const;
type Part = (typeof PARTS)[number];
type Spec = {
  key: string;
  headers: string[];
  required: number[];
  options: Record<string, string[]>;
  numbers: number[];
  signedNumbers: number[];
  dates: number[];
  jsonFields?: number[];
};
type StoredRecord = { values: unknown[] };
type Data = Record<Part, Array<StoredRecord & { id: string }>>;
const SPECS = schemas as unknown as Spec[];

function safeTable(part: Part, userId: string): string {
  const safeId = userId.replace(/[^A-Za-z0-9_]/g, '_');
  return `crm_${part}_${safeId}`;
}

function getSpec(part: unknown): Spec | null {
  return typeof part === 'string'
    ? SPECS.find(spec => spec.key === part) || null
    : null;
}

async function listPart(
  part: Part,
  userId: string
): Promise<Array<StoredRecord & { id: string }>> {
  const result = await db.list<StoredRecord>(safeTable(part, userId), {
    limit: 500,
  });
  return result.items.map(item => ({ id: item.id, values: item.values }));
}

async function loadData(userId: string): Promise<Data> {
  const lists = await Promise.all(PARTS.map(part => listPart(part, userId)));
  return Object.fromEntries(
    PARTS.map((part, index) => [part, lists[index]])
  ) as Data;
}

function normalize(spec: Spec, raw: unknown): unknown[] {
  if (!Array.isArray(raw) || raw.length !== spec.headers.length)
    throw new Error('จำนวนช่องข้อมูลไม่ตรงกับแบบฟอร์ม');
  return raw.map((value, index) => {
    if (value === null || value === undefined || value === '') return null;
    if (spec.numbers.includes(index)) {
      const number = Number(value);
      if (!Number.isFinite(number))
        throw new Error(`ตัวเลขไม่ถูกต้อง: ${spec.headers[index]}`);
      if (!spec.signedNumbers.includes(index) && number < 0)
        throw new Error(`ตัวเลขต้องไม่ติดลบ: ${spec.headers[index]}`);
      return number;
    }
    if (spec.jsonFields?.includes(index)) {
      try {
        JSON.parse(String(value));
      } catch {
        throw new Error(`รูปแบบ JSON ไม่ถูกต้อง: ${spec.headers[index]}`);
      }
    }
    return String(value);
  });
}

function validate(
  part: Part,
  spec: Spec,
  values: unknown[],
  data: Data,
  editing: boolean
): void {
  for (const index of spec.required)
    if (values[index] === null || String(values[index] ?? '').trim() === '')
      throw new Error(`กรุณากรอก ${spec.headers[index]}`);
  for (const [key, choices] of Object.entries(spec.options || {})) {
    const index = Number(key);
    if (
      values[index] !== null &&
      !choices.includes(String(values[index])) &&
      !(part === 'customers' && index === 5)
    )
      throw new Error(`ค่าที่เลือกไม่ถูกต้อง: ${spec.headers[index]}`);
  }
  for (const index of spec.dates || [])
    if (
      values[index] !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(values[index]))
    )
      throw new Error(`วันที่ไม่ถูกต้อง: ${spec.headers[index]}`);
  if (
    part === 'customers' &&
    values[24] !== null &&
    !/^\d{13}$/.test(String(values[24]))
  )
    throw new Error('เลขทะเบียนนิติบุคคลต้องมี 13 หลัก');
  if (
    !editing &&
    data[part].some(record => String(record.values[0]) === String(values[0]))
  )
    throw new Error('รหัสนี้มีอยู่แล้ว');
  if (
    part === 'cases' &&
    !data.customers.some(
      record => String(record.values[0]) === String(values[1])
    )
  )
    throw new Error('ไม่พบรหัสลูกค้า');
  if (part === 'contacts' || part === 'tasks') {
    if (
      !data.customers.some(
        record => String(record.values[0]) === String(values[1])
      )
    )
      throw new Error('ไม่พบรหัสลูกค้า');
    if (values[2] !== null) {
      const linked = data.cases.find(
        record => String(record.values[0]) === String(values[2])
      );
      if (!linked) throw new Error('ไม่พบรหัสเคส');
      if (String(linked.values[1]) !== String(values[1]))
        throw new Error('ลูกค้าไม่ตรงกับเคส');
    }
  }
  if (
    part === 'documents' &&
    !data.cases.some(record => String(record.values[0]) === String(values[1]))
  )
    throw new Error('ไม่พบรหัสเคส');
}

const ADMIN_EMAILS = ['chgfill@gmail.com'];
const auth: RouterMiddleware[] = [
  requireAuth(),
  requireAdminEmailAllowlist(ADMIN_EMAILS),
];

export const handler = router({
  'GET /api/session': [...auth, async () => json({ authorized: true })],
  'GET /api/data': [
    ...auth,
    async ctx => {
      try {
        return json(await loadData(ctx.user!.userId));
      } catch (cause) {
        console.error('load_data_failed', cause);
        return error('โหลดข้อมูลไม่สำเร็จ', 500);
      }
    },
  ],
  'POST /api/records': [
    ...auth,
    async ctx => {
      try {
        const body = ctx.body as { part?: unknown; values?: unknown };
        const spec = getSpec(body?.part);
        if (!spec) return error('ไม่พบประเภทข้อมูล');
        const part = spec.key as Part;
        const values = normalize(spec, body.values);
        const userId = ctx.user!.userId;
        const data = await loadData(userId);
        validate(part, spec, values, data, false);
        const id = String(values[0]);
        const [createdId] = await db.tx.add(safeTable(part, userId), [
          { id, values },
        ]);
        if (!createdId) return error('รหัสนี้มีอยู่แล้ว', 409);
        return json({ data: await loadData(userId) }, 201);
      } catch (cause) {
        console.warn('create_record_rejected', cause);
        return error(
          cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ',
          400
        );
      }
    },
  ],
  'PUT /api/records/:part/:id': [
    ...auth,
    async ctx => {
      try {
        const spec = getSpec(ctx.params.part);
        if (!spec) return error('ไม่พบประเภทข้อมูล');
        const part = spec.key as Part,
          userId = ctx.user!.userId,
          id = ctx.params.id;
        const table = safeTable(part, userId);
        const [existing] = await db.get<StoredRecord>(table, [id], {
          consistent: true,
        });
        if (!existing) return error('ไม่พบรายการเดิม', 404);
        const values = normalize(
          spec,
          (ctx.body as { values?: unknown })?.values
        );
        if (String(values[0]) !== id) return error('ห้ามเปลี่ยนรหัสรายการ');
        const data = await loadData(userId);
        validate(part, spec, values, data, true);
        const [updated] = await db.tx.update(table, [
          { id, record: { values } },
        ]);
        if (!updated) return error('แก้ไขไม่สำเร็จ', 409);
        return json({ data: await loadData(userId) });
      } catch (cause) {
        console.warn('update_record_rejected', cause);
        return error(
          cause instanceof Error ? cause.message : 'แก้ไขไม่สำเร็จ',
          400
        );
      }
    },
  ],
  'DELETE /api/records/:part/:id': [
    ...auth,
    async ctx => {
      try {
        const spec = getSpec(ctx.params.part);
        if (!spec) return error('ไม่พบประเภทข้อมูล');
        const part = spec.key as Part;
        if (part === 'customers')
          return error(
            'ไม่ลบทะเบียนลูกค้าโดยตรง กรุณาเปลี่ยนเป็นเก็บถาวร',
            409
          );
        const userId = ctx.user!.userId,
          id = ctx.params.id,
          data = await loadData(userId);
        if (
          part === 'cases' &&
          (data.contacts.some(r => String(r.values[2]) === id) ||
            data.tasks.some(r => String(r.values[2]) === id) ||
            data.documents.some(r => String(r.values[1]) === id))
        )
          return error(
            'ลบเคสไม่ได้เพราะมีประวัติ งาน หรือเอกสารเชื่อมโยงอยู่',
            409
          );
        const [deleted] = await db.delete(safeTable(part, userId), [id]);
        if (!deleted) return error('ไม่พบรายการ', 404);
        return json({ data: await loadData(userId) });
      } catch (cause) {
        console.warn('delete_record_rejected', cause);
        return error('ลบรายการไม่สำเร็จ', 400);
      }
    },
  ],
});
