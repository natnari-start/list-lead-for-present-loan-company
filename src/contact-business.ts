// CRM recording aids, not bank eligibility rules or consent evidence.
export const FUNDING_PLANS = ['ไม่มีแผน', 'อาจมีแผน', 'มีแผน', 'ยังไม่ทราบ'] as const;
export const DOCUMENT_STAGES = ['ยังไม่ขอ', 'ขอ Prescreen', 'นัดถ่ายรูปและสัมภาษณ์', 'ขอ Full Doc'] as const;
export const QUALITY_RESULTS = ['ยังไม่ทราบ', 'ผ่านตามที่พนักงานเห็น', 'ไม่ผ่านตามที่พนักงานเห็น'] as const;
export const BUSINESS_QUESTIONS = [
  ['businessType', 'ประเภทธุรกิจตามที่ลูกค้าแจ้ง'],
  ['monthlySales', 'ยอดขายต่อเดือนตามที่ลูกค้าแจ้ง'],
  ['currentLoans', 'สินเชื่อปัจจุบันตามที่ลูกค้าแจ้ง'],
  ['newLoansSixMonths', 'สินเชื่อใหม่ในช่วง 6 เดือนตามที่ลูกค้าแจ้ง'],
  ['ownership', 'การเป็นเจ้าของ / สัดส่วนหุ้นตามที่ลูกค้าแจ้ง'],
] as const;
export const QUALITY_CRITERIA = [
  ['entity', 'ประเภทกิจการ / นิติบุคคล'],
  ['businessAge', 'อายุธุรกิจ — คู่มือระบุขัดกัน 6 ปีกับ 8 ปี'],
  ['financialResults', 'ผลประกอบการจากงบการเงิน'],
  ['equity', 'ส่วนของผู้ถือหุ้น'],
  ['directors', 'โครงสร้างกรรมการ'],
  ['margin', 'Margin ธุรกิจ'],
  ['revenue', 'รายได้หลัก'],
  ['serviceArea', 'พื้นที่ให้บริการ'],
] as const;
type AnswerKey = typeof BUSINESS_QUESTIONS[number][0];
type QualityKey = typeof QUALITY_CRITERIA[number][0];
export type BusinessForm = {
  fundingPlan: string;
  questionsAsked: boolean;
  answers: Record<AnswerKey, string>;
  quality: Record<QualityKey, string>;
  qualityNote: string;
  documentStage: string;
};
export function emptyBusinessForm(): BusinessForm {
  return {
    fundingPlan: '', questionsAsked: false,
    answers: Object.fromEntries(BUSINESS_QUESTIONS.map(([key]) => [key, ''])) as BusinessForm['answers'],
    quality: Object.fromEntries(QUALITY_CRITERIA.map(([key]) => [key, 'ยังไม่ทราบ'])) as BusinessForm['quality'],
    qualityNote: '', documentStage: '',
  };
}
export function businessData(form: BusinessForm, full: boolean, callback: boolean, callbackAt: string, callbackChannel: string) {
  const data: Record<string, unknown> = { version: 1 };
  if (form.fundingPlan.trim()) data.fundingPlan = form.fundingPlan;
  if (callback && (callbackAt || callbackChannel)) data.callback = {
    ...(callbackAt ? { at: callbackAt } : {}),
    ...(callbackChannel.trim() ? { channel: callbackChannel.trim() } : {}),
  };
  if (full) {
    const answers = Object.fromEntries(BUSINESS_QUESTIONS.filter(([key]) => form.questionsAsked && form.answers[key].trim()).map(([key]) => [key, form.answers[key].trim()]));
    if (Object.keys(answers).length) data.answers = answers;
    if (QUALITY_CRITERIA.some(([key]) => form.quality[key] !== 'ยังไม่ทราบ') || form.qualityNote.trim()) {
      data.quality = { ...form.quality };
      if (form.qualityNote.trim()) data.qualityNote = form.qualityNote.trim();
    }
    if (form.documentStage) data.documentStage = form.documentStage;
  }
  return Object.keys(data).length > 1 ? data : null;
}
export function mergeBusinessJson(previous: string | null, data: Record<string, unknown> | null): string | null {
  if (!data) return previous;
  const existing = previous ? JSON.parse(previous) : {};
  if (!isObject(existing) || Object.prototype.hasOwnProperty.call(existing, 'crmContactV1')) throw new Error('ไม่สามารถรวม JSON โดยไม่ทับข้อมูลเดิมได้');
  return JSON.stringify({ ...existing, crmContactV1: data });
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validateBusinessJson(raw: string, full: boolean, callback: boolean): string {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || Object.keys(parsed).length !== 1 || !isObject(parsed.crmContactV1)) return 'รูปแบบ JSON ข้อมูลการสนทนาไม่ถูกต้อง';
    const data = parsed.crmContactV1;
    const allowed = ['version', 'fundingPlan', ...(callback ? ['callback'] : []), ...(full ? ['answers', 'quality', 'qualityNote', 'documentStage'] : [])];
    if (data.version !== 1 || Object.keys(data).some(key => !allowed.includes(key))) return 'JSON ไม่ตรงกับผลการติดต่อหรือเวอร์ชันที่รองรับ';
    if (data.fundingPlan !== undefined && !FUNDING_PLANS.includes(data.fundingPlan as never)) return 'แผนใช้เงินไม่อยู่ในตัวเลือก';
    if (data.documentStage !== undefined && !DOCUMENT_STAGES.includes(data.documentStage as never)) return 'ขั้นเอกสารไม่อยู่ในตัวเลือก';
    if (data.answers !== undefined) {
      if (!isObject(data.answers) || Object.entries(data.answers).some(([key, value]) => !BUSINESS_QUESTIONS.some(([k]) => k === key) || typeof value !== 'string' || value.length > 2000)) return 'คำตอบธุรกิจไม่ถูกต้อง';
    }
    if (data.quality !== undefined) {
      if (!isObject(data.quality) || Object.keys(data.quality).length !== 8 || QUALITY_CRITERIA.some(([key]) => !QUALITY_RESULTS.includes((data.quality as Record<string, unknown>)[key] as never))) return 'ผลเกณฑ์คุณภาพไม่ถูกต้อง';
    }
    if (data.qualityNote !== undefined && (typeof data.qualityNote !== 'string' || data.qualityNote.length > 2000)) return 'หมายเหตุเกณฑ์คุณภาพไม่ถูกต้อง';
    if (data.callback !== undefined) {
      if (!isObject(data.callback) || Object.keys(data.callback).some(key => !['at', 'channel'].includes(key)) || Object.values(data.callback).some(value => typeof value !== 'string' || value.length > 2000)) return 'ข้อมูลติดต่อกลับไม่ถูกต้อง';
      if (data.callback.at && (typeof data.callback.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(data.callback.at))) return 'วันเวลาติดต่อกลับไม่ถูกต้อง';
    }
    return '';
  } catch { return 'ข้อมูล JSON ไม่ถูกต้อง'; }
}
