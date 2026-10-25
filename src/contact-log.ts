import { schemas } from './schema.ts';

export type ContactRow = { id: string; values: unknown[] };
export type ContactForm = {
  customerId: string;
  caseId: string;
  contactedAt: string;
  channel: string;
  person: string;
  outcome: string;
  facts: string;
  agreements: string;
  suggestions: string;
  callbackAt: string;
  callbackChannel: string;
  callbackAllowed: boolean;
  productPresented: boolean;
  salesSheet: string;
  verify: string;
  verifiedAt: string;
  evidence: string;
};

type ContactSpec = { headers: readonly string[]; options: Record<string, readonly string[]> };
export const contactSpec = schemas.find(spec => spec.key === 'contacts')! as unknown as ContactSpec;
export const contactHeaders = {
  id: 'รหัสบันทึก', customerId: 'รหัสลูกค้า', caseId: 'รหัสเคส (ถ้ามี)',
  contactedAt: 'วันเวลาติดต่อ', channel: 'ช่องทาง', person: 'ผู้ที่ติดต่อด้วย',
  outcome: 'ผลการติดต่อ', facts: 'สรุปข้อเท็จจริง', agreements: 'ข้อตกลงที่ยืนยันแล้ว',
  suggestions: 'ข้อเสนอ AI / รอตรวจ', salesSheet: 'รุ่น Sales Sheet ที่ใช้',
  verify: 'ผล Call Verify ก่อนติดต่อ', verifiedAt: 'วันเวลาตรวจ Call Verify',
  evidence: 'อ้างอิงหลักฐานสิทธิติดต่อ', businessJson: 'รายละเอียดธุรกิจจากการติดต่อ (JSON)',
} as const;

export function contactIndexes(headers: readonly string[] = contactSpec.headers) {
  return Object.fromEntries(Object.entries(contactHeaders).map(([key, header]) => {
    const index = headers.indexOf(header);
    if (index < 0) throw new Error('ไม่พบหัวคอลัมน์ประวัติการติดต่อ: ' + header);
    return [key, index];
  })) as Record<keyof typeof contactHeaders, number>;
}

export function bangkokDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function isContactDateTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return false;
  const [, y, m, d, h, min, sec = '0'] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +sec));
  return +y >= 1900 && date.getUTCFullYear() === +y && date.getUTCMonth() === +m - 1 &&
    date.getUTCDate() === +d && +h < 24 && +min < 60 && +sec < 60;
}

export const fullContactOutcome = (outcome: string) => ['สนใจ', 'ติดตามสถานะ'].includes(outcome);

export function emptyContactForm(context: { customerId?: string; caseId?: string } = {}): ContactForm {
  return {
    customerId: context.customerId || '', caseId: context.caseId || '', contactedAt: bangkokDateTime(),
    channel: '', person: '', outcome: '', facts: '', agreements: '', suggestions: '',
    callbackAt: '', callbackChannel: '', callbackAllowed: false, productPresented: false,
    salesSheet: '', verify: 'ยังไม่ตรวจ', verifiedAt: '', evidence: '',
  };
}

function addLine(text: string, line: string) {
  return text.includes(line) ? text : [text, line].filter(Boolean).join('\n');
}

export function draftContact(form: ContactForm) {
  const full = fullContactOutcome(form.outcome);
  const callback = form.outcome === 'ขอคุยใหม่';
  const facts = form.facts.trim() || (form.outcome ? 'ผลการติดต่อ: ' + form.outcome : '');
  let agreements = full || callback ? form.agreements.trim() : '';
  let suggestions = full || callback ? form.suggestions.trim() : '';
  if (callback && (form.callbackAt || form.callbackChannel)) {
    const when = form.callbackAt ? form.callbackAt.replace('T', ' ') + ' น. (เวลาไทย)' : 'ยังไม่ยืนยันเวลา';
    const channel = form.callbackChannel || 'ยังไม่ยืนยันช่องทาง';
    if (form.callbackAllowed) {
      agreements = addLine(agreements, 'พนักงานระบุว่าลูกค้าอนุญาตให้ติดต่อกลับ: ' + when + ' · ' + channel);
    } else {
      suggestions = addLine(suggestions, 'แผนติดต่อกลับ / รอยืนยันจากลูกค้า: ' + when + ' · ' + channel);
    }
  } else if ((callback || full) && form.callbackAllowed) {
    agreements = addLine(agreements, 'พนักงานระบุว่าลูกค้าอนุญาตให้ติดต่อกลับ โดยยังไม่ยืนยันวันเวลา');
  }
  return { facts, agreements, suggestions };
}

export function contactValues(form: ContactForm, headers: readonly string[] = contactSpec.headers) {
  const indexes = contactIndexes(headers);
  const text = draftContact(form);
  const values: Array<string | null> = headers.map(() => null);
  const set = (key: keyof typeof indexes, value: string) => { values[indexes[key]] = value.trim() || null; };
  for (const key of ['customerId', 'caseId', 'contactedAt', 'channel', 'person', 'outcome', 'verify', 'verifiedAt', 'evidence'] as const) set(key, form[key]);
  set('facts', text.facts);
  set('agreements', text.agreements);
  set('suggestions', text.suggestions);
  if (fullContactOutcome(form.outcome) && form.productPresented) set('salesSheet', form.salesSheet);
  return values;
}

export function validateContactValues(values: unknown[], headers: readonly string[] = contactSpec.headers) {
  if (values.length !== headers.length || values.some(value => value !== null && typeof value !== 'string')) return 'ข้อมูลไม่ตรงกับโครงสร้างประวัติการติดต่อ';
  const indexes = contactIndexes(headers);
  const value = (key: keyof typeof indexes) => String(values[indexes[key]] ?? '').trim();
  if (values.some(item => typeof item === 'string' && item.length > 20000)) return 'ข้อความบางช่องยาวเกิน 20,000 ตัวอักษร';
  for (const key of ['customerId', 'contactedAt', 'channel', 'outcome', 'facts'] as const) {
    if (!value(key)) return 'กรุณากรอก' + contactHeaders[key];
  }
  if (!isContactDateTime(value('contactedAt')) || (value('verifiedAt') && !isContactDateTime(value('verifiedAt')))) return 'กรุณาตรวจวันเวลาให้ถูกต้อง (เวลาไทย)';
  for (const key of ['channel', 'outcome', 'verify'] as const) {
    const choices = contactSpec.options[String(indexes[key])];
    if (value(key) && !choices?.includes(value(key))) return 'ค่าของช่อง ' + contactHeaders[key] + ' ไม่อยู่ในรายการ';
  }
  if (value('businessJson')) return 'รายการใหม่ไม่รับข้อมูล JSON จากแบบฟอร์มนี้';
  return '';
}
