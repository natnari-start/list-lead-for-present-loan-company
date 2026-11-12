import { field, text, blank, type Row } from './crm-read-model.ts';

export const taskStatuses = ['รอดำเนินการ', 'กำลังดำเนินการ', 'เสร็จแล้ว', 'ยกเลิก'] as const;
export const dateKinds = ['นัดลูกค้ายืนยัน', 'แผนงานภายใน', 'ยังไม่ยืนยัน'] as const;
export type TaskGroup = 'วันนี้' | 'เกินกำหนด' | 'รอถึงกำหนด' | 'รอยืนยันวัน' | 'ยังไม่กำหนดวัน' | 'วันรอตรวจ' | 'ประเภทวันรอตรวจ' | 'สถานะรอตรวจ' | 'เสร็จแล้ว' | 'ยกเลิก';
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2200) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function bangkokToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (kind: string) => parts.find(p => p.type === kind)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const isOpenTask = (row: Row) => ['รอดำเนินการ', 'กำลังดำเนินการ'].includes(text(field(row, 'tasks', 'สถานะงาน')));
export function classifyTask(row: Row, today: string, datesVerified = false): TaskGroup {
  const status = text(field(row, 'tasks', 'สถานะงาน'));
  const due = field(row, 'tasks', 'วันครบกำหนด');
  const kind = text(field(row, 'tasks', 'ประเภทวันกำหนด'));
  if (!(taskStatuses as readonly string[]).includes(status)) return 'สถานะรอตรวจ';
  if (status === 'เสร็จแล้ว' || status === 'ยกเลิก') return status;
  if (!blank(due) && (!validDate(due) || !datesVerified || !validDate(today))) return 'วันรอตรวจ';
  if (kind === 'ยังไม่ยืนยัน') return 'รอยืนยันวัน';
  if (!(dateKinds as readonly string[]).includes(kind)) return 'ประเภทวันรอตรวจ';
  if (blank(due)) return 'ยังไม่กำหนดวัน';
  const date = text(due);
  return date < today ? 'เกินกำหนด' : date === today ? 'วันนี้' : 'รอถึงกำหนด';
}
export function taskWarnings(row: Row) {
  const due = field(row, 'tasks', 'วันครบกำหนด');
  const kind = text(field(row, 'tasks', 'ประเภทวันกำหนด'));
  const status = text(field(row, 'tasks', 'สถานะงาน'));
  const completed = field(row, 'tasks', 'วันที่เสร็จ');
  return [
    kind === 'นัดลูกค้ายืนยัน' && blank(due) ? 'ข้อมูลนัดยืนยันไม่ครบ: ไม่มีวันครบกำหนด' : '',
    kind === 'ยังไม่ยืนยัน' ? 'รอยืนยันวัน — ไม่ใช่นัดลูกค้ายืนยัน' : '',
    !blank(completed) && status !== 'เสร็จแล้ว' ? 'วันที่เสร็จกับสถานะงานไม่สอดคล้องกัน' : '',
    status === 'เสร็จแล้ว' && blank(completed) ? 'ไม่มีวันที่เสร็จที่บันทึกไว้' : '',
    !blank(completed) && !validDate(completed) ? 'วันที่เสร็จรอตรวจ' : '',
  ].filter(Boolean);
}

