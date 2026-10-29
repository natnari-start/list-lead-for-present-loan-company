import {
  error,
  json,
  type RouterMiddleware,
  requireAuth,
  router,
  secrets,
} from '@appdeploy/sdk';
import { schemas } from '../src/schema';
import { CONTACT_SEARCH_HEADER, isContactSearchValue } from '../src/contact-search-status';
import { contactIndexes, validateContactValues } from '../src/contact-log';
import { financialSchema, validateFinancialEntry } from '../src/financial-screening';
import { createHash } from 'node:crypto';
import { createGoogleSheetsContact, createGoogleSheetsCustomer, createGoogleSheetsFinancial, deleteGoogleSheetsRecords, describeGoogleSheetsFailure, GoogleSheetsConflictError, inspectGoogleSheets, loadGoogleSheetsData, updateGoogleSheetsRecord } from './googleSheets';

type SheetSpec = {
  key: string;
  sheetName: string;
  headers: string[];
  dates?: number[];
  numbers?: number[];
  required?: number[];
  options?: Record<string, string[]>;
  optional?: boolean;
};

const SPECS = [...schemas, financialSchema] as unknown as SheetSpec[];
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
  const userEmail = ctx.user?.email?.trim().toLowerCase();
  if (!userEmail) return error('ไม่พบอีเมลผู้ใช้สำหรับตรวจสิทธิ์', 403);
  const isAllowed = allowedEmails.some(
    email => email.trim().toLowerCase() === userEmail
  );
  if (!isAllowed) return error('บัญชีนี้ไม่ได้รับอนุญาต', 403);
};
const auth: RouterMiddleware[] = [requireAuth(), adminAllowlist];
const bangkokDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const validDate = (value: unknown) => {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text;
};
function validateCustomerCreate(spec: SheetSpec, values: unknown[]): string | null {
  if (values.length !== spec.headers.length) return 'จำนวนช่องทะเบียนลูกค้าไม่ตรงกับ schema';
  if (values.some(value => typeof value === 'string' && value.length > 20000)) return 'ข้อมูลบางช่องยาวเกินขีดจำกัด';
  for (const index of spec.required || []) {
    if (values[index] === null || values[index] === undefined || String(values[index]).trim() === '') {
      return 'กรุณากรอก ' + spec.headers[index];
    }
  }
  for (const [rawIndex, choices] of Object.entries(spec.options || {})) {
    const index = Number(rawIndex), value = values[index];
    if (value !== null && value !== undefined && String(value).trim() && !choices.includes(String(value))) {
      return 'ค่า ' + spec.headers[index] + ' ไม่อยู่ในตัวเลือกที่รองรับ';
    }
  }
  for (const index of spec.numbers || []) {
    const value = values[index];
    if (value !== null && value !== undefined && String(value).trim() && !Number.isFinite(Number(value))) {
      return spec.headers[index] + ' ต้องเป็นตัวเลข';
    }
  }
  for (const index of spec.dates || []) {
    const value = values[index];
    if (value !== null && value !== undefined && String(value).trim() && !validDate(value)) {
      return spec.headers[index] + ' ต้องเป็นวันที่รูปแบบ YYYY-MM-DD';
    }
  }
  const contactSearchIndex = spec.headers.indexOf(CONTACT_SEARCH_HEADER);
  if (contactSearchIndex >= 0 && values[contactSearchIndex] !== null && values[contactSearchIndex] !== undefined &&
    String(values[contactSearchIndex]).trim() && !isContactSearchValue(values[contactSearchIndex])) {
    return 'ค่าผลค้นหา Google ต้องเป็น TRUE หรือ FALSE';
  }
  return null;
}

function validateFinancialValues(spec: SheetSpec, values: unknown[]): string | null {
  if (values.length !== spec.headers.length) return 'จำนวนช่องงบการเงินไม่ตรงกับ schema';
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(new Date()));
  if (!String(values[1] ?? '').trim()) return 'ไม่พบรหัสลูกค้า';
  return validateFinancialEntry(values[2], values[3], values[4], values[5], currentYear);
}

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
      if (payload?.part !== 'contacts' && payload?.part !== 'customers' && payload?.part !== 'financials') return error('ประเภทข้อมูลนี้ยังไม่รองรับการเพิ่ม', 405);
      const spec = SPECS.find(item => item.key === payload.part)!;
      if (typeof payload.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(payload.requestId) || !Array.isArray(payload.values)) {
        return error('รูปแบบคำขอสร้างรายการไม่ถูกต้อง', 400);
      }
      const values = [...payload.values];
      const hash = createHash('sha256').update(user!.userId + ':' + payload.requestId).digest('hex');
      if (payload.part === 'financials') {
        if (values[0] !== null) return error('รหัสงบการเงินต้องสร้างโดย backend', 400);
        values[6] = 'กรอกใน WebApp';
        values[7] = bangkokDate();
        values[8] = user!.email || user!.userId;
        const invalidFinancial = validateFinancialValues(spec, values);
        if (invalidFinancial) return error(invalidFinancial, 400);
        try {
          const current = await loadGoogleSheetsData(SPECS);
          if (!current.customers.some(row => row.id === String(values[1]))) return error('ไม่พบลูกค้าในทะเบียน', 400);
          const year = Number(values[2]);
          const stableHash = createHash('sha256').update('financial:' + String(values[1]) + ':' + year).digest('hex');
          values[0] = 'FINANCIAL-' + stableHash.slice(0, 32).toUpperCase();
          const duplicate = (current.financials || []).find(row =>
            String(row.values[1]) === String(values[1]) && Number(row.values[2]) === year
          );
          if (duplicate && duplicate.id !== values[0]) return error('ลูกค้ารายนี้มีข้อมูลงบปีดังกล่าวแล้ว กรุณาแก้ไขรายการเดิม', 409);
          return json(await createGoogleSheetsFinancial(SPECS, stableHash, values));
        } catch (cause) {
          if (cause instanceof GoogleSheetsConflictError) return error(cause.message, 409);
          const failure = describeGoogleSheetsFailure(cause);
          return error('ยังยืนยันการบันทึกงบการเงินไม่ได้: ' + failure.message, failure.status === 403 ? 403 : 502);
        }
      }
      if (payload.part === 'customers') {
        if (values[0] !== null) return error('รหัสลูกค้าต้องสร้างโดย backend', 400);
        const today = bangkokDate();
        values[0] = 'CUSTOMER-' + hash.slice(0, 32).toUpperCase();
        values[1] = today;
        values[19] = 'ใช้งาน';
        values[22] = today;
        for (const index of spec.numbers || []) {
          if (values[index] !== null && values[index] !== undefined && String(values[index]).trim()) values[index] = Number(values[index]);
        }
        const invalidCustomer = validateCustomerCreate(spec, values);
        if (invalidCustomer) return error(invalidCustomer, 400);
        try {
          const current = await loadGoogleSheetsData(SPECS);
          const registration = String(values[24] ?? '').trim();
          if (registration && current.customers.some(row => row.id !== values[0] && String(row.values[24] ?? '').trim() === registration)) {
            return error('เลขทะเบียนนิติบุคคลนี้ซ้ำกับรายการอื่น กรุณาตรวจสอบก่อนบันทึก', 409);
          }
          return json(await createGoogleSheetsCustomer(SPECS, hash, values));
        } catch (cause) {
          if (cause instanceof GoogleSheetsConflictError) return error(cause.message, 409);
          const failure = describeGoogleSheetsFailure(cause);
          return error('ยังยืนยันการบันทึกลูกค้าไม่ได้ กรุณาตรวจสอบคำขอเดิมอีกครั้ง: ' + failure.message, failure.status === 403 ? 403 : 502);
        }
      }
      const invalid = validateContactValues(values, spec.headers);
      if (invalid) return error(invalid, 400);
      const indexes = contactIndexes(spec.headers);
      if (values[indexes.id] !== null) return error('รหัสบันทึกต้องสร้างโดย backend', 400);
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
    async ({ body, params, user }) => {
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
      if (spec.key === 'financials') {
        if (String(values[1]) !== String(expectedValues[1])) return error('ไม่สามารถเปลี่ยนเจ้าของข้อมูลงบได้', 400);
        values[6] = expectedValues[6] || 'กรอกใน WebApp';
        values[7] = bangkokDate();
        values[8] = user!.email || user!.userId;
        const invalidFinancial = validateFinancialValues(spec, values);
        if (invalidFinancial) return error(invalidFinancial, 400);
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
        if (spec.key === 'financials') {
          if (!current.customers.some(row => row.id === String(values[1]))) return error('ไม่พบลูกค้าในทะเบียน', 400);
          if (rows.some(row => row.id !== id && String(row.values[1]) === String(values[1]) && Number(row.values[2]) === Number(values[2]))) {
            return error('ลูกค้ารายนี้มีข้อมูลงบปีดังกล่าวแล้ว', 409);
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
    async ({ params }) => {
      if (params.part !== 'customers') return error('รองรับการลบเฉพาะทะเบียนลูกค้า', 405);
      const id = String(params.id || '').trim();
      if (!id) return error('ไม่พบรหัสลูกค้าที่ต้องการลบ', 400);
      try {
        const current = await loadGoogleSheetsData(SPECS);
        const matches = current.customers.filter(row => row.id === id);
        if (matches.length > 1) return error('พบรหัสลูกค้าซ้ำ จึงหยุดการลบเพื่อป้องกันข้อมูลผิดรายการ', 409);
        if (!matches.length) return json({ data: current, deleted: false, replayed: true, deletedFinancials: 0 });

        const linked = {
          cases: current.cases.filter(row => String(row.values[1] ?? '') === id).length,
          contacts: current.contacts.filter(row => String(row.values[1] ?? '') === id).length,
          tasks: current.tasks.filter(row => String(row.values[1] ?? '') === id).length,
        };
        const linkedTotal = linked.cases + linked.contacts + linked.tasks;
        if (linkedTotal > 0) {
          return error(
            `ลบบริษัทไม่ได้ เพราะมีข้อมูลเชื่อมโยง: เคส ${linked.cases}, ประวัติติดต่อ ${linked.contacts}, งานติดตาม ${linked.tasks} กรุณาเก็บถาวรแทน`,
            409
          );
        }

        const financialIds = (current.financials || [])
          .filter(row => String(row.values[1] ?? '') === id)
          .map(row => row.id);
        await deleteGoogleSheetsRecords(SPECS, [
          { key: 'financials', ids: financialIds },
          { key: 'customers', ids: [id] },
        ]);
        return json({
          data: await loadGoogleSheetsData(SPECS),
          deleted: true,
          replayed: false,
          deletedFinancials: financialIds.length,
        });
      } catch (cause) {
        if (cause instanceof GoogleSheetsConflictError) return error(cause.message, 409);
        const failure = describeGoogleSheetsFailure(cause);
        console.warn('google_sheets_delete_failed ' + failure.code + ' ' + (failure.stage || 'unknown') + ' ' + (failure.status || 0) + ' ' + (failure.reason || ''));
        return error('ลบบริษัทไม่สำเร็จ: ' + failure.message, failure.status === 403 ? 403 : 502);
      }
    },
  ],
});
