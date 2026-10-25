import {
  error,
  json,
  type RouterMiddleware,
  requireAuth,
  requireAdminEmailAllowlist,
  router,
  secrets,
} from '@appdeploy/sdk';
import { schemas } from '../src/schema';
import { CONTACT_SEARCH_HEADER, isContactSearchValue } from '../src/contact-search-status';
import { contactIndexes, validateContactValues } from '../src/contact-log';
import { createHash } from 'node:crypto';
import { createGoogleSheetsContact, describeGoogleSheetsFailure, GoogleSheetsConflictError, inspectGoogleSheets, loadGoogleSheetsData, updateGoogleSheetsRecord } from './googleSheets';

type SheetSpec = {
  key: string;
  sheetName: string;
  headers: string[];
  dates?: number[];
  numbers?: number[];
  required?: number[];
  options?: Record<string, string[]>;
};

const SPECS = schemas as unknown as SheetSpec[];
const adminAllowlist: RouterMiddleware = async (ctx) => {
  let allowedEmails: string[];
  try {
    const raw = await secrets.readSecret('ADMIN_EMAILS');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw.split(/[,\r\n]/).map(value => value.trim()).filter(Boolean);
    }
    allowedEmails = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : typeof parsed === 'string' && parsed.trim() ? [parsed.trim()] : [];
  } catch {
    return error('ยังไม่ได้ตั้งค่า ADMIN_EMAILS ใน AppDeploy secrets', 503);
  }
  if (!allowedEmails.length) return error('ADMIN_EMAILS ไม่มีบัญชีผู้ดูแลที่ถูกต้อง', 503);
  return requireAdminEmailAllowlist(allowedEmails.map(email => email.trim().toLowerCase()))(ctx);
};
const auth: RouterMiddleware[] = [requireAuth(), adminAllowlist];

export const handler = router({
  'GET /api/session': [...auth, async () => json({ authorized: true })],
  'GET /api/integration/google-sheets/status': [
    ...auth,
    async () => {
      try {
        const secretNames = await secrets.listSecretNames();
        if (!secretNames.includes('GOOGLE_SERVICE_ACCOUNT_JSON') || !secretNames.includes('GOOGLE_SPREADSHEET_ID')) {
          return json({ configured: false, connected: false });
        }
        return json(await inspectGoogleSheets(SPECS));
      } catch (cause) {
        const failure = describeGoogleSheetsFailure(cause);
        console.warn('google_sheets_status_check_failed ' + failure.code + ' ' + (failure.stage || 'unknown') + ' ' + (failure.status || 0) + ' ' + (failure.reason || ''));
        return json({
          configured: true,
          connected: false,
          errorCode: failure.code,
          errorMessage: failure.message,
        });
      }
    },
  ],
  'GET /api/data': [
    ...auth,
    async () => {
      try {
        const secretNames = await secrets.listSecretNames();
        if (!secretNames.includes('GOOGLE_SERVICE_ACCOUNT_JSON') || !secretNames.includes('GOOGLE_SPREADSHEET_ID')) {
          return error('ยังไม่ได้ตั้งค่า Google Sheets credential', 503);
        }
        return json(await loadGoogleSheetsData(SPECS));
      } catch (cause) {
        const failure = describeGoogleSheetsFailure(cause);
        console.warn('google_sheets_data_load_failed ' + failure.code + ' ' + (failure.stage || 'unknown') + ' ' + (failure.status || 0) + ' ' + (failure.reason || ''));
        return error(failure.message + ' ระบบไม่ได้แสดงข้อมูล Sandbox แทน', 502);
      }
    },
  ],
  'POST /api/records': [
    ...auth,
    async ({ body, user }) => {
      const payload = body as { part?: unknown; requestId?: unknown; values?: unknown } | null;
      if (payload?.part !== 'contacts') return error('รุ่นนี้เพิ่มได้เฉพาะประวัติการติดต่อ', 405);
      const spec = SPECS.find(item => item.key === 'contacts')!;
      if (typeof payload.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(payload.requestId) || !Array.isArray(payload.values)) {
        return error('รูปแบบคำขอสร้างประวัติไม่ถูกต้อง', 400);
      }
      const values = [...payload.values];
      const invalid = validateContactValues(values, spec.headers);
      if (invalid) return error(invalid, 400);
      const indexes = contactIndexes(spec.headers);
      if (values[indexes.id] !== null) return error('รหัสบันทึกต้องสร้างโดย backend', 400);
      const hash = createHash('sha256').update(user!.userId + ':' + payload.requestId).digest('hex');
      values[indexes.id] = 'CONTACT-' + hash.slice(0, 32).toUpperCase();
      try {
        // This is a shared CRM sheet, accessible only to the configured admins.
        // The idempotency key is scoped to the authenticated user's stable ID.
        const current = await loadGoogleSheetsData(SPECS);
        if (!current.customers.some(row => row.id === values[indexes.customerId])) return error('กรุณาเลือกบริษัทที่มีอยู่ในทะเบียน', 400);
        if (values[indexes.caseId]) {
          const selected = current.cases.find(row => row.id === values[indexes.caseId]);
          const customerIndex = SPECS.find(item => item.key === 'cases')!.headers.indexOf('รหัสลูกค้า');
          if (!selected || selected.values[customerIndex] !== values[indexes.customerId]) return error('เคสที่เลือกไม่ตรงกับบริษัท', 400);
        }
        return json(await createGoogleSheetsContact(SPECS, hash, values));
      } catch (cause) {
        if (cause instanceof GoogleSheetsConflictError) return error(cause.message, 409);
        const failure = describeGoogleSheetsFailure(cause);
        return error('ยังยืนยันการบันทึกไม่ได้ กรุณาตรวจสอบคำขอเดิมอีกครั้ง: ' + failure.message, failure.status === 403 ? 403 : 502);
      }
    },
  ],

  'PUT /api/records/:part/:id': [
    ...auth,
    async ({ body, params }) => {
      const spec = SPECS.find(item => item.key === params.part);
      if (!spec) return error('ไม่พบประเภทข้อมูลที่ต้องการแก้ไข', 404);
      const payload = body as { values?: unknown; expectedValues?: unknown } | null;
      if (!payload || !Array.isArray(payload.values) || !Array.isArray(payload.expectedValues) ||
        payload.values.length !== spec.headers.length || payload.expectedValues.length !== spec.headers.length) {
        return error('ข้อมูลแก้ไขไม่ครบหรือไม่ตรงกับโครงสร้างชีต', 400);
      }
      const values = payload.values as unknown[];
      const expectedValues = payload.expectedValues as unknown[];
      const id = params.id;
      if (String(values[0] ?? '') !== id || String(expectedValues[0] ?? '') !== id) {
        return error('รหัสรายการแก้ไขไม่ได้', 400);
      }
      if (values.some(value => value !== null && typeof value !== 'string' && typeof value !== 'number')) {
        return error('รูปแบบข้อมูลบางช่องไม่ถูกต้อง', 400);
      }
      if (values.some(value => typeof value === 'string' && value.length > 20000)) {
        return error('ข้อมูลบางช่องยาวเกินขีดจำกัด', 400);
      }
      const changed = (index: number) =>
        JSON.stringify(values[index] ?? null) !== JSON.stringify(expectedValues[index] ?? null);
      const contactSearchIndex = spec.headers.indexOf(CONTACT_SEARCH_HEADER);
      if (spec.key === 'customers' && contactSearchIndex >= 0 &&
        changed(contactSearchIndex) && !isContactSearchValue(values[contactSearchIndex])) {
        return error('ค่าผลค้นหา Google ต้องเป็น TRUE หรือ FALSE', 400);
      }
      const formulaColumns = spec.key === 'tasks' ? [9] : [];
      if (formulaColumns.some(changed)) return error('ช่องคำนวณอัตโนมัติแก้ไขไม่ได้', 400);
      for (const index of spec.required || []) {
        if (changed(index) && (values[index] === null || String(values[index] ?? '').trim() === '')) {
          return error('กรุณากรอกข้อมูลที่จำเป็น: ' + spec.headers[index], 400);
        }
      }
      for (const [indexText, choices] of Object.entries(spec.options || {})) {
        const index = Number(indexText);
        const value = values[index];
        if (changed(index) && value !== null && String(value) !== '' && !choices.includes(String(value))) {
          return error('ค่าของช่อง ' + spec.headers[index] + ' ไม่อยู่ในรายการที่กำหนด', 400);
        }
      }
      for (const index of spec.dates || []) {
        const value = values[index];
        if (changed(index) && value !== null && value !== '' &&
          !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(String(value))) {
          return error('รูปแบบวันที่ไม่ถูกต้อง: ' + spec.headers[index], 400);
        }
      }
      for (const index of spec.numbers || []) {
        const value = values[index];
        if (changed(index) && value !== null && value !== '' && !Number.isFinite(Number(value))) {
          return error('กรุณากรอกตัวเลขที่ถูกต้อง: ' + spec.headers[index], 400);
        }
      }

      try {
        const current = await loadGoogleSheetsData(SPECS);
        const rows = current[spec.key] || [];
        if (!rows.some(row => row.id === id)) return error('ไม่พบรายการนี้ใน Google Sheets', 404);

        if (spec.key === 'customers') {
          const registrationIndex = 24;
          const registration = String(values[registrationIndex] ?? '').trim();
          if (changed(registrationIndex) && registration && rows.some(row =>
            row.id !== id && String(row.values[registrationIndex] ?? '').trim() === registration
          )) {
            return error('เลขทะเบียนนิติบุคคลนี้ซ้ำกับรายการอื่น กรุณาตรวจสอบก่อนบันทึก', 409);
          }
        }
        if (spec.key === 'cases' || spec.key === 'contacts' || spec.key === 'tasks') {
          const customerId = String(values[1] ?? '');
          if (changed(1) && !current.customers.some(row => row.id === customerId)) {
            return error('กรุณาเลือกลูกค้าที่มีอยู่ในทะเบียน', 400);
          }
        }
        if ((spec.key === 'contacts' || spec.key === 'tasks') && changed(2) && values[2]) {
          const caseRow = current.cases.find(row => row.id === String(values[2]));
          if (!caseRow || String(caseRow.values[1]) !== String(values[1])) {
            return error('เคสที่เลือกไม่ตรงกับลูกค้า', 400);
          }
        }
        if (spec.key === 'documents' && changed(1)) {
          const caseRow = current.cases.find(row => row.id === String(values[1]));
          if (!caseRow) return error('กรุณาเลือกเคสที่มีอยู่', 400);
        }

        await updateGoogleSheetsRecord(SPECS, spec.key, id, expectedValues, values);
        return json({ data: await loadGoogleSheetsData(SPECS), updated: true });
      } catch (cause) {
        if (cause instanceof GoogleSheetsConflictError) return error(cause.message, 409);
        const failure = describeGoogleSheetsFailure(cause);
        console.warn('google_sheets_update_failed ' + failure.code + ' ' + (failure.stage || 'unknown') + ' ' + (failure.status || 0) + ' ' + (failure.reason || ''));
        const message = failure.status === 403
          ? 'บันทึกไม่สำเร็จ: กรุณาตั้งสิทธิ์ service account เป็น Editor ใน Google Sheet'
          : failure.message;
        return error(message, failure.status === 403 ? 403 : 502);
      }
    },
  ],
  'DELETE /api/records/:part/:id': [
    ...auth,
    async () => error('รุ่นนี้เปิด Google Sheets แบบอ่านอย่างเดียว', 405),
  ],
});
