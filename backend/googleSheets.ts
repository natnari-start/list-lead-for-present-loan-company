import { secrets } from '@appdeploy/sdk';
import { CONTACT_SEARCH_HEADER, isContactSearchChecked } from '../src/contact-search-status';
import { contactIndexes } from '../src/contact-log';

type SheetSpec = {
  key: string;
  sheetName: string;
  headers: string[];
  dates?: number[];
  numbers?: number[];
  required?: number[];
  options?: Record<string, string[]>;
};

type ServiceAccount = {
  type?: string;
  client_email?: string;
  private_key?: string;
};

type GoogleToken = {
  access_token?: string;
  expires_in?: number;
};

type SpreadsheetMetadata = {
  properties?: { title?: string; locale?: string };
  namedRanges?: Array<{ namedRangeId?: string }>;
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      gridProperties?: { rowCount?: number };
    };
    tables?: Array<{
      tableId?: string;
      range?: { startColumnIndex?: number; endColumnIndex?: number };
      columnProperties?: Array<{ columnIndex?: number; columnType?: string }>;
    }>;
  }>;
};

type ValuesResponse = { values?: unknown[][] };
type SheetData = Record<string, Array<{ id: string; values: unknown[] }>>;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

type FailureCategory =
  | 'api_disabled'
  | 'permission_denied'
  | 'sheet_not_found'
  | 'credential_invalid'
  | 'configuration_missing'
  | 'upstream_error';

class GoogleSheetsFailure extends Error {
  category: FailureCategory;
  status?: number;
  reason?: string;
  stage: string;

  constructor(category: FailureCategory, status?: number, reason?: string, stage = 'unknown') {
    super('Google Sheets connection failed');
    this.category = category;
    this.status = status;
    this.reason = reason;
    this.stage = stage;
  }
}

function classifyGoogleFailure(status: number, reason = ''): FailureCategory {
  const normalized = reason.toLowerCase();
  if (normalized.includes('accessnotconfigured') || normalized.includes('servicedisabled')) return 'api_disabled';
  if (status === 401 || normalized.includes('invalid_grant') || normalized.includes('unauthorized')) return 'credential_invalid';
  if (status === 404 || normalized.includes('notfound')) return 'sheet_not_found';
  if (status === 403 || normalized.includes('permission_denied')) return 'permission_denied';
  return 'upstream_error';
}

export function describeGoogleSheetsFailure(cause: unknown): {
  code: FailureCategory;
  message: string;
  status?: number;
  reason?: string;
  stage: string;
} {
  const failure = cause instanceof GoogleSheetsFailure
    ? cause
    : new GoogleSheetsFailure('upstream_error');
  const messages: Record<FailureCategory, string> = {
    api_disabled: 'ยังไม่ได้เปิดใช้ Google Sheets API ในโปรเจกต์ Google Cloud ที่ผูกกับ service account',
    permission_denied: 'service account ไม่มีสิทธิ์เข้าถึงชีต หรือยังไม่มีสิทธิ์แก้ไข กรุณาแชร์ชีตให้ client_email ของ service account เป็น Editor',
    sheet_not_found: 'ไม่พบชีต หรือ service account ไม่มีสิทธิ์เข้าถึงไฟล์ กรุณาตรวจ spreadsheet ID และการแชร์',
    credential_invalid: 'credential ของ service account ไม่ถูกต้องหรือหมดอายุ กรุณาตรวจ secret GOOGLE_SERVICE_ACCOUNT_JSON',
    configuration_missing: 'ยังไม่ได้ตั้งค่า GOOGLE_SPREADSHEET_ID ใน AppDeploy secrets',
    upstream_error: 'การเชื่อมต่อกับ Google ล้มเหลว กรุณาตรวจสถานะ API และเครือข่ายของ backend',
  };
  const stages: Record<string, string> = {
    secret_read: 'อ่าน secret จาก AppDeploy',
    spreadsheet_config: 'อ่าน Spreadsheet ID จาก AppDeploy secret',
    credential_json: 'แปลผล credential',
    private_key: 'นำ private key มาใช้',
    oauth_network: 'เชื่อมต่อ OAuth ของ Google',
    oauth_token: 'ขอ OAuth token',
    sheets_network: 'เชื่อมต่อ Google Sheets API',
    sheets_api: 'เรียก Google Sheets API',
    write_api: 'บันทึกการแก้ไขลง Google Sheets',
  };
  const stageLabel = stages[failure.stage];
  return {
    code: failure.category,
    message: (stageLabel ? 'ล้มเหลวที่ขั้นตอน ' + stageLabel + ': ' : '') + messages[failure.category],
    status: failure.status,
    reason: failure.reason,
    stage: failure.stage,
  };
}
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const MAX_GRID_ROWS = 5000;
let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodePem(value: string): Uint8Array {
  const body = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(body);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function createAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  let rawCredential: string;
  try {
    rawCredential = await secrets.readSecret('GOOGLE_SERVICE_ACCOUNT_JSON');
  } catch {
    throw new GoogleSheetsFailure('credential_invalid', undefined, 'secret_read', 'secret_read');
  }
  let account: ServiceAccount;
  try {
    account = JSON.parse(rawCredential) as ServiceAccount;
  } catch {
    throw new GoogleSheetsFailure('credential_invalid', undefined, 'invalid_json', 'credential_json');
  }
  if (account.type !== 'service_account' || !account.client_email || !account.private_key) {
    throw new GoogleSheetsFailure('credential_invalid', undefined, 'missing_fields', 'credential_json');
  }
  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    base64Url(JSON.stringify({
      iss: account.client_email,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })),
  ].join('.');
  let signature: ArrayBuffer;
  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      decodePem(account.private_key.replace(/\\n/g, '\n')),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(unsigned)
    );
  } catch {
    throw new GoogleSheetsFailure('credential_invalid', undefined, 'key_import_or_sign', 'private_key');
  }
  const assertion = unsigned + '.' + base64Url(new Uint8Array(signature));
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
  } catch {
    throw new GoogleSheetsFailure('upstream_error', undefined, 'network_error', 'oauth_network');
  }
  if (!response.ok) {
    let reason = '';
    try {
      const body = await response.json() as { error?: string };
      reason = body.error || '';
    } catch {}
    throw new GoogleSheetsFailure(classifyGoogleFailure(response.status, reason), response.status, reason, 'oauth_token');
  }
  const token = (await response.json()) as GoogleToken;
  if (!token.access_token) throw new Error('Google token response was empty');
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1000,
  };
  return token.access_token;
}

async function googleGet<T>(url: string): Promise<T> {
  const token = await createAccessToken();
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  } catch {
    throw new GoogleSheetsFailure('upstream_error', undefined, 'network_error', 'sheets_network');
  }
  if (!response.ok) {
    let reason = '';
    try {
      const body = await response.json() as { error?: { status?: string; errors?: Array<{ reason?: string }> } };
      reason = body.error?.errors?.[0]?.reason || body.error?.status || '';
    } catch {}
    throw new GoogleSheetsFailure(classifyGoogleFailure(response.status, reason), response.status, reason, 'sheets_api');
  }
  return (await response.json()) as T;
}

function columnName(columnNumber: number): string {
  let number = columnNumber;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function headerRange(spec: SheetSpec): string {
  return "'" + spec.sheetName.replace(/'/g, "''") + "'!A1:" + columnName(spec.headers.length) + '1';
}

async function getSpreadsheetId(): Promise<string> {
  let value: string;
  try {
    value = (await secrets.readSecret('GOOGLE_SPREADSHEET_ID')).trim();
  } catch {
    throw new GoogleSheetsFailure('configuration_missing', undefined, 'missing_secret', 'spreadsheet_config');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new GoogleSheetsFailure('configuration_missing', undefined, 'invalid_spreadsheet_id', 'spreadsheet_config');
  }
  return value;
}

async function valuesUrl(range: string): Promise<string> {
  const spreadsheetId = await getSpreadsheetId();
  return 'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(spreadsheetId) +
    '/values/' +
    encodeURIComponent(range) +
    '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE';
}

async function getMetadata(): Promise<SpreadsheetMetadata> {
  const spreadsheetId = await getSpreadsheetId();
  return googleGet<SpreadsheetMetadata>(
    'https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(spreadsheetId) +
      '?fields=' +
      encodeURIComponent('properties(title,locale),namedRanges(namedRangeId),sheets(properties(sheetId,title,gridProperties(rowCount)),tables(tableId,range,columnProperties))')
  );
}

function actualHeader(values: ValuesResponse): unknown[] {
  return values.values?.[0] || [];
}

function headersMatch(actual: unknown[] | undefined, expected: string[]): boolean {
  if (!actual || actual.length < expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (String(actual[index] ?? '') !== expected[index]) return false;
  }
  return actual.slice(expected.length).every(value => value === '' || value === null);
}

function toIsoDate(value: unknown, locale: string, includeTime: boolean): unknown {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const date = iso[1] + '-' + iso[2].padStart(2, '0') + '-' + iso[3].padStart(2, '0');
    return includeTime && iso[4]
      ? date + 'T' + iso[4].padStart(2, '0') + ':' + iso[5] + ':' + (iso[6] || '00')
      : date;
  }
  const parts = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!parts) return raw;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const yearRaw = Number(parts[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const isUs = /^(en_US|en-US)$/i.test(locale);
  const month = isUs ? first : second;
  const day = isUs ? second : first;
  if (month < 1 || month > 12 || day < 1 || day > 31) return raw;
  const date = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  return includeTime && parts[4]
    ? date + 'T' + parts[4].padStart(2, '0') + ':' + parts[5] + ':' + (parts[6] || '00')
    : date;
}

function normalizeValue(value: unknown, index: number, spec: SheetSpec, locale: string): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (spec.headers[index] === CONTACT_SEARCH_HEADER &&
    (typeof value === 'boolean' || /^(TRUE|FALSE)$/i.test(String(value).trim()))) {
    return isContactSearchChecked(value) ? 'TRUE' : 'FALSE';
  }
  if (spec.dates?.includes(index)) {
    return toIsoDate(
      value,
      locale,
      spec.key === 'contacts' && (index === 3 || index === 12)
    );
  }
  if (spec.numbers?.includes(index)) {
    if (typeof value === 'number') return value;
    const numeric = Number(String(value).replace(/[,\s฿]/g, '').replace(/บาท/g, ''));
    return Number.isFinite(numeric) ? numeric : value;
  }
  return String(value);
}

async function readHeader(spec: SheetSpec): Promise<unknown[]> {
  return actualHeader(await googleGet<ValuesResponse>(await valuesUrl(headerRange(spec))));
}

export async function inspectGoogleSheets(
  specs: SheetSpec[]
): Promise<{
  connected: boolean;
  mode: 'read-only-check';
  spreadsheetTitle: string;
  checkedSheets: Array<{ name: string; headerCount: number; headersMatch: boolean }>;
}> {
  const metadata = await getMetadata();
  const availableNames = new Set(
    (metadata.sheets || []).map(sheet => sheet.properties?.title || '')
  );
  const checkedSheets = await Promise.all(specs.map(async spec => {
    if (!availableNames.has(spec.sheetName)) {
      return { name: spec.sheetName, headerCount: 0, headersMatch: false };
    }
    const actual = await readHeader(spec);
    return {
      name: spec.sheetName,
      headerCount: actual.filter(value => value !== '' && value !== null).length,
      headersMatch: headersMatch(actual, spec.headers),
    };
  }));
  return {
    connected: checkedSheets.every(sheet => sheet.headersMatch),
    mode: 'read-only-check',
    spreadsheetTitle: metadata.properties?.title || '',
    checkedSheets,
  };
}

export async function loadGoogleSheetsData(specs: SheetSpec[]): Promise<SheetData> {
  const metadata = await getMetadata();
  const sheets = new Map(
    (metadata.sheets || []).map(sheet => [sheet.properties?.title || '', sheet])
  );
  const data: SheetData = {};
  for (const spec of specs) {
    const sheet = sheets.get(spec.sheetName);
    if (!sheet) throw new Error('Required Google Sheet tab is missing');
    const header = await readHeader(spec);
    if (!headersMatch(header, spec.headers)) {
      throw new Error('Google Sheet headers do not match the application schema');
    }
    const gridRows = sheet.properties?.gridProperties?.rowCount || 1;
    if (gridRows > MAX_GRID_ROWS) {
      throw new Error('Google Sheet exceeds the safe row limit for a complete read');
    }
    const lastColumn = columnName(spec.headers.length);
    const range = "'" + spec.sheetName.replace(/'/g, "''") + "'!A2:" + lastColumn + gridRows;
    const response = gridRows > 1
      ? await googleGet<ValuesResponse>(await valuesUrl(range))
      : { values: [] };
    const rows = (response.values || [])
      .filter(row => row[0] !== null && row[0] !== undefined && String(row[0]).trim() !== '')
      .map(row => {
        const values = spec.headers.map((_, index) =>
          normalizeValue(row[index], index, spec, metadata.properties?.locale || 'th_TH')
        );
        return { id: String(values[0]), values };
      });
    data[spec.key] = rows;
  }
  return data;
}

export class GoogleSheetsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsConflictError';
  }
}

// The receipt and the append share one atomic Sheets batch. A repeated receipt ID
// makes the whole batch fail, including when requests reach different workers.
export async function createGoogleSheetsContact(specs: SheetSpec[], receiptHash: string, values: unknown[]) {
  const spec = specs.find(item => item.key === 'contacts');
  if (!spec || !/^[a-f0-9]{64}$/.test(receiptHash)) throw new Error('คำขอสร้างประวัติไม่ถูกต้อง');
  const indexes = contactIndexes(spec.headers);
  const id = String(values[indexes.id]);
  const receiptId = 'crm_contact_' + receiptHash;
  const expected = values.map((value, index) => normalizeValue(value, index, spec, 'th_TH'));
  const findSaved = async () => {
    const rows = (await loadGoogleSheetsData([spec])).contacts.filter(row => row.id === id);
    if (rows.length > 1) throw new GoogleSheetsConflictError('พบรหัสประวัติซ้ำ กรุณาตรวจสอบก่อนสร้างรายการใหม่');
    const saved = rows[0];
    if (saved && JSON.stringify(saved.values) !== JSON.stringify(expected)) {
      throw new GoogleSheetsConflictError('คำขอเดิมมีข้อมูลบันทึกแล้ว แต่เนื้อหาไม่ตรงกับร่างนี้ กรุณารีเฟรชเพื่อตรวจรายการเดิม');
    }
    return saved;
  };
  const existing = await findSaved();
  if (existing) return { record: existing, created: false, replayed: true };
  const metadata = await getMetadata();
  const sheet = metadata.sheets?.find(item => item.properties?.title === spec.sheetName);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || !headersMatch(await readHeader(spec), spec.headers)) {
    throw new GoogleSheetsConflictError('หัวตารางประวัติการติดต่อไม่ตรง กรุณาตรวจโครงสร้างชีตก่อนบันทึก');
  }
  if (metadata.namedRanges?.some(item => item.namedRangeId === receiptId)) {
    throw new GoogleSheetsConflictError('คำขอนี้เคยถูกบันทึกแล้ว แต่ไม่พบแถวเดิม กรุณาตรวจประวัติก่อนสร้างรายการใหม่');
  }
  const table = sheet?.tables?.find(item => (item.range?.startColumnIndex || 0) === 0);
  if (table && table.range?.endColumnIndex !== spec.headers.length) {
    throw new GoogleSheetsConflictError('ตารางประวัติการติดต่อยังไม่ครอบคลุมทุกคอลัมน์ กรุณาดำเนินการ migration ก่อน');
  }
  if (table && (spec.dates || []).some(index =>
    table.columnProperties?.find(column => (column.columnIndex || 0) === index)?.columnType !== 'DATE_TIME'
  )) throw new GoogleSheetsConflictError('คอลัมน์วันเวลาต้องเป็น DATE_TIME กรุณาดำเนินการ migration ก่อน');

  const quoted = "'" + spec.sheetName.replace(/'/g, "''") + "'";
  const spreadsheetId = await getSpreadsheetId();
  const template = await googleGet<{ sheets?: Array<{ data?: Array<{ rowData?: Array<{ values?: Array<{ userEnteredFormat?: Record<string, unknown>; dataValidation?: unknown }> }> }> }> }>(
    'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + '?ranges=' +
    encodeURIComponent(quoted + '!A2:' + columnName(spec.headers.length) + '2') +
    '&includeGridData=true&fields=' + encodeURIComponent('sheets(data(rowData(values(userEnteredFormat,dataValidation))))')
  );
  const exemplar = template.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
  const cells = values.map((value, index) => {
    const input = toSheetsInput(value, index, spec);
    const format = exemplar[index]?.userEnteredFormat || {};
    const textFormat = { ...(format.textFormat as Record<string, unknown> || { fontFamily: 'Arial', fontSize: 11 }) };
    delete textFormat.link;
    const userEnteredFormat: Record<string, unknown> = {
      verticalAlignment: format.verticalAlignment || 'MIDDLE',
      wrapStrategy: format.wrapStrategy || 'WRAP',
      textFormat,
    };
    if (!table) userEnteredFormat.numberFormat = spec.dates?.includes(index)
      ? { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' } : { type: 'TEXT' };
    return {
      userEnteredValue: typeof input === 'number' ? { numberValue: input } : { stringValue: String(input) },
      userEnteredFormat,
      ...(!table && exemplar[index]?.dataValidation ? { dataValidation: exemplar[index].dataValidation } : {}),
    };
  });
  const requests = [
    { addNamedRange: { namedRange: {
      namedRangeId: receiptId, name: 'CRM_CONTACT_' + receiptHash,
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
    } } },
    { appendCells: {
      ...(table?.tableId ? { tableId: table.tableId } : { sheetId }),
      rows: [{ values: cells }],
      fields: table ? 'userEnteredValue,userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' : 'userEnteredValue,userEnteredFormat,dataValidation',
    } },
  ];
  try {
    const token = await createAccessToken();
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + ':batchUpdate', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    if (!response.ok) throw new GoogleSheetsFailure(classifyGoogleFailure(response.status), response.status, 'contact_append_failed', 'write_api');
  } catch (cause) {
    // A response can be lost after commit. Read back this same stable ID; never
    // retry with a fresh ID or write to an existing row as a recovery action.
    const saved = await findSaved();
    if (saved) return { record: saved, created: false, replayed: true };
    throw cause;
  }
  return { record: { id, values: expected }, created: true, replayed: false };
}

function canonicalValue(value: unknown): unknown {
  return value === '' || value === undefined ? null : value;
}

function dateToSerial(value: unknown): number {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error('วันที่ต้องอยู่ในรูปแบบวันที่ที่ถูกต้อง');
  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  );
  return timestamp / 86400000 + 25569;
}

function toSheetsInput(value: unknown, index: number, spec: SheetSpec): string | number | boolean {
  if (value === null || value === undefined || value === '') return '';
  if (spec.headers[index] === CONTACT_SEARCH_HEADER) return isContactSearchChecked(value);
  if (spec.dates?.includes(index)) return dateToSerial(value);
  if (spec.numbers?.includes(index)) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) throw new Error('ช่องตัวเลขมีค่าที่ไม่ถูกต้อง');
    return numeric;
  }
  return String(value);
}

async function googleBatchUpdate(body: {
  valueInputOption: string;
  data: Array<{ range: string; majorDimension: string; values: Array<Array<string | number | boolean>> }>;
}): Promise<void> {
  const token = await createAccessToken();
  let response: Response;
  try {
    response = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(await getSpreadsheetId()) + '/values:batchUpdate',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
  } catch {
    throw new GoogleSheetsFailure('upstream_error', undefined, 'network_error', 'write_api');
  }
  if (!response.ok) {
    let reason = '';
    try {
      const body = await response.json() as { error?: { status?: string; errors?: Array<{ reason?: string }> } };
      reason = body.error?.errors?.[0]?.reason || body.error?.status || '';
    } catch {}
    throw new GoogleSheetsFailure(classifyGoogleFailure(response.status, reason), response.status, reason, 'write_api');
  }
}

export async function updateGoogleSheetsRecord(
  specs: SheetSpec[],
  key: string,
  id: string,
  expectedValues: unknown[],
  nextValues: unknown[]
): Promise<void> {
  const spec = specs.find(item => item.key === key);
  if (!spec) throw new Error('ไม่พบประเภทข้อมูลที่ต้องการแก้ไข');
  if (expectedValues.length !== spec.headers.length || nextValues.length !== spec.headers.length) {
    throw new Error('จำนวนช่องข้อมูลไม่ตรงกับโครงสร้างชีต');
  }
  if (String(expectedValues[0] ?? '') !== id || String(nextValues[0] ?? '') !== id) {
    throw new Error('รหัสรายการแก้ไขไม่ได้');
  }

  const metadata = await getMetadata();
  const sheet = (metadata.sheets || []).find(item => item.properties?.title === spec.sheetName);
  if (!sheet) throw new Error('ไม่พบแท็บ Google Sheets ที่ต้องการแก้ไข');
  if (!headersMatch(await readHeader(spec), spec.headers)) {
    throw new GoogleSheetsConflictError('หัวตารางถูกเปลี่ยน กรุณาตรวจโครงสร้างชีตก่อนบันทึก');
  }
  const rowCount = sheet.properties?.gridProperties?.rowCount || 1;
  const lastColumn = columnName(spec.headers.length);
  const sheetRange = "'" + spec.sheetName.replace(/'/g, "''") + "'";
  const idValues = await googleGet<ValuesResponse>(await valuesUrl(sheetRange + '!A2:A' + rowCount));
  const matchingRows = (idValues.values || [])
    .map((row, index) => ({ id: String(row[0] ?? ''), rowNumber: index + 2 }))
    .filter(row => row.id === id);
  if (!matchingRows.length) throw new GoogleSheetsConflictError('ไม่พบรายการนี้ใน Google Sheets แล้ว กรุณารีเฟรช');
  if (matchingRows.length > 1) throw new GoogleSheetsConflictError('พบรหัสรายการซ้ำใน Google Sheets จึงหยุดการบันทึก');

  const rowNumber = matchingRows[0].rowNumber;
  const rowRange = sheetRange + '!A' + rowNumber + ':' + lastColumn + rowNumber;
  const currentResponse = await googleGet<ValuesResponse>(await valuesUrl(rowRange));
  const currentRow = spec.headers.map((_, index) =>
    normalizeValue(currentResponse.values?.[0]?.[index], index, spec, metadata.properties?.locale || 'th_TH')
  );
  const formulaColumns = spec.key === 'tasks' ? [9] : [];
  const changedSinceRead = currentRow.some((value, index) =>
    !formulaColumns.includes(index) &&
    JSON.stringify(canonicalValue(value)) !== JSON.stringify(canonicalValue(expectedValues[index]))
  );
  if (changedSinceRead) {
    throw new GoogleSheetsConflictError('รายการถูกผู้อื่นแก้ไขหลังจากโหลด กรุณารีเฟรชก่อนบันทึก');
  }

  const updates: Array<{ range: string; majorDimension: string; values: Array<Array<string | number | boolean>> }> = [];
  let segmentStart = -1;
  let segmentValues: Array<string | number | boolean> = [];
  const flush = (endIndex: number) => {
    if (segmentStart < 0) return;
    updates.push({
      range: sheetRange + '!' + columnName(segmentStart + 1) + rowNumber + ':' + columnName(endIndex + 1) + rowNumber,
      majorDimension: 'ROWS',
      values: [segmentValues],
    });
    segmentStart = -1;
    segmentValues = [];
  };

  for (let index = 1; index < spec.headers.length; index += 1) {
    const protectedFormula = formulaColumns.includes(index);
    const changed = !protectedFormula &&
      JSON.stringify(canonicalValue(currentRow[index])) !== JSON.stringify(canonicalValue(nextValues[index]));
    if (!changed) {
      flush(index - 1);
      continue;
    }
    if (segmentStart < 0) segmentStart = index;
    segmentValues.push(toSheetsInput(nextValues[index], index, spec));
  }
  flush(spec.headers.length - 1);
  if (!updates.length) return;

  await googleBatchUpdate({
    valueInputOption: 'RAW',
    data: updates,
  });
}
