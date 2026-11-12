import { schemas } from './schema.ts';

export type Row = { id: string; values: unknown[] };
export type Part = 'customers' | 'cases' | 'contacts' | 'tasks' | 'documents';
export type ReadData = Record<Part, Row[]>;
export type Issue = { part: Part; id: string; reason: string };
export const text = (v: unknown) => v === null || v === undefined ? '' : String(v);
export const blank = (v: unknown) => !text(v).trim();
export function field(row: Row, part: Part, header: string): unknown {
  const spec = schemas.find(s => s.key === part)!;
  const index = (spec.headers as readonly string[]).indexOf(header);
  if (index < 0) throw new Error(`ไม่พบหัวคอลัมน์ ${part}: ${header}`);
  return row.values[index];
}
export function buildReadModel(data: ReadData) {
  const issues: Issue[] = [];
  const maps = {} as Record<Part, Map<string, Row>>;
  const reject = (part: Part, row: Row, reason: string) => issues.push({ part, id: row.id, reason });
  for (const part of ['customers', 'cases', 'contacts', 'tasks', 'documents'] as Part[]) {
    const spec = schemas.find(s => s.key === part)!;
    const counts = new Map<string, number>();
    for (const row of data[part]) counts.set(row.id, (counts.get(row.id) || 0) + 1);
    maps[part] = new Map();
    for (const row of data[part]) {
      if (blank(row.id) || row.id !== row.id.trim() || row.id !== text(row.values[0])) reject(part, row, 'รหัสว่าง มีช่องว่าง หรือไม่ตรงกับรหัสรายการ');
      else if (counts.get(row.id)! > 1) reject(part, row, 'รหัสซ้ำ');
      else if (row.values.length !== spec.headers.length) reject(part, row, 'จำนวนฟิลด์ไม่ตรงกับ schema');
      else maps[part].set(row.id, row);
    }
  }
  for (const [id, row] of maps.cases) {
    if (!maps.customers.has(text(field(row, 'cases', 'รหัสลูกค้า')))) {
      reject('cases', row, 'ไม่พบลูกค้าที่เชื่อมโยงหรือรหัสลูกค้ากำกวม'); maps.cases.delete(id);
    }
  }
  for (const part of ['tasks', 'contacts'] as const) {
    for (const [id, row] of maps[part]) {
      const customerId = text(field(row, part, 'รหัสลูกค้า'));
      const caseId = text(field(row, part, 'รหัสเคส (ถ้ามี)'));
      const loan = maps.cases.get(caseId);
      if (!maps.customers.has(customerId) || (caseId !== '' && (!loan || text(field(loan, 'cases', 'รหัสลูกค้า')) !== customerId))) {
        reject(part, row, 'รหัสลูกค้าและเคสไม่สัมพันธ์กัน หรือไม่พบรายการที่เชื่อม'); maps[part].delete(id);
      }
    }
  }
  for (const [id, row] of maps.documents) {
    if (!maps.cases.has(text(field(row, 'documents', 'รหัสเคส')))) {
      reject('documents', row, 'ไม่พบเคสที่เชื่อมโยงหรือรหัสเคสกำกวม'); maps.documents.delete(id);
    }
  }
  return { ...maps, issues };
}
export type ReadModel = ReturnType<typeof buildReadModel>;
export function company(model: ReadModel, customerId: unknown) {
  const row = model.customers.get(text(customerId));
  return row ? text(field(row, 'customers', 'ชื่อบริษัท')) || 'ยังไม่ระบุชื่อบริษัท' : 'ไม่พบลูกค้าที่เชื่อมโยง';
}
export function contactPolicy(customer?: Row) {
  const status = customer ? text(field(customer, 'customers', 'สถานะคำขอระงับการติดต่อ')) : '';
  const blocked = ['ขอระงับ', 'ส่งดำเนินการแล้ว'].includes(status);
  return { blocked, label: blocked ? 'มีคำขอระงับการติดต่อ — ห้ามเริ่มติดต่อ' : status === 'ไม่พบคำขอในข้อมูลที่ตรวจ' ? 'ไม่พบคำขอในข้อมูลที่ตรวจ — ไม่ใช่การยืนยันสิทธิ์ติดต่อ' : 'ยังไม่ยืนยันสิทธิ์ติดต่อ' };
}
export function presentMoney(value: unknown) {
  if (blank(value)) return 'ยังไม่ระบุ';
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)} บาท`
    : `${text(value)} (ค่าเดิม / รอตรวจ)`;
}

