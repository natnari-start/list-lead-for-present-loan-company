import { sharedSheetsRead, invalidateSharedSheetsCache } from './sheetsReadCache';
import { secrets } from '@appdeploy/sdk';
import { CONTACT_SEARCH_HEADER, isContactSearchChecked } from '../src/contact-search-status';
import { contactIndexes } from '../src/contact-log';
import { toIsoDate } from '../src/google-sheet-date';

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
  properties?: { title?: string; locale?: string; timeZone?: string };
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
  | 'quota_exceeded'
  | 'secret_read_failed'
  | 'upstream_error';

class GoogleSheetsFailure extends Error {
  category: FailureCategory;
  status?: number;
  reason?: string;
  stage: string;
  retryAfterMs?: number;

  constructor(category: FailureCategory, status?: number, reason?: string, stage = 'unknown') {
    super('Google Sheets connection failed');
    this.category = category;
    this.status = status;
    this.reason = reason;
    this.stage = stage;
  }
}

function responseFailure(response: Response, reason: string, stage: string): GoogleSheetsFailure {
  const failure = new GoogleSheetsFailure(classifyGoogleFailure(response.status, reason), response.status, reason, stage);
  const header = response.headers.get('Retry-After');
  if (header) {
    const seconds = Number(header);
    failure.retryAfterMs = Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now());
  }
  return failure;
}

export async function assertGoogleSheetsConfiguration(): Promise<void> {
  let names: string[];
  try { names = await secrets.listSecretNames(); }
  catch { throw new GoogleSheetsFailure('secret_read_failed', undefined, 'secret_list_failed', 'secret_read'); }
  if (!names.includes('GOOGLE_SPREADSHEET_ID') || !names.includes('GOOGLE_SERVICE_ACCOUNT_JSON')) {
    throw new GoogleSheetsFailure('configuration_missing', undefined, 'missing_secret', 'secret_read');
  }
}

function classifyGoogleFailure(status: number, reason = ''): FailureCategory {
  const normalized = reason.toLowerCase();
  if (status === 429 || /ratelimit|resource_exhausted|quota/.test(normalized)) return 'quota_exceeded';
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
    configuration_missing: 'ยังไม่ได้ตั้งค่า GOOGLE_SPREADSHEET_ID หรือ GOOGLE_SERVICE_ACCOUNT_JSON ใน AppDeploy secrets',
    quota_exceeded: 'Google Sheets เกินโควตาการเรียกใช้งาน กรุณารอประมาณหนึ่งนาทีแล้วลองเชื่อมต่อใหม่',
    secret_read_failed: 'อ่านค่าตั้งค่าจาก AppDeploy ไม่สำเร็จชั่วคราว กรุณาลองใหม่ ยังไม่ยืนยันว่า Secret หาย',
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
    throw new GoogleSheetsFailure('secret_read_failed', undefined, 'secret_read', 'secret_read');
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

async function fetchWithQuotaRetry(url: string, init: RequestInit): Promise<Response> {
  // Retry only an explicit quota rejection. Never replay ambiguous writes.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= 3 || (init.method && init.method !== 'GET')) return response;
    const retryAfter = response.headers.get('Retry-After');
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const serverDelay = Number.isFinite(seconds) ? seconds * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
    if (serverDelay > 8000) return response;
    await new Promise(resolve => setTimeout(resolve,
      Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 1000), serverDelay || 0)));
  }
}

async function googleGet<T>(url: string): Promise<T> {
  const token = await createAccessToken();
  let response: Response;
  try {
    response = await fetchWithQuotaRetry(url, { headers: { Authorization: 'Bearer ' + token } });
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
    throw new GoogleSheetsFailure('secret_read_failed', undefined, 'secret_read', 'spreadsheet_config');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new GoogleSheetsFailure('configuration_missing', undefined, 'invalid_spreadsheet_id', 'spreadsheet_config');
  }
  return value;
}

async function valuesUrl(range: string, unformattedDates = false): Promise<string> {
  const spreadsheetId = await getSpreadsheetId();
  return 'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(spreadsheetId) +
    '/values/' +
    encodeURIComponent(range) +
    '?majorDimension=ROWS&valueRenderOption=' +
    (unformattedDates ? 'UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER' : 'FORMATTED_VALUE');
}

async function readRecordValues(range: string, spec: SheetSpec): Promise<ValuesResponse> {
  const formatted = await googleGet<ValuesResponse>(await valuesUrl(range));
  if (!spec.dates?.length) return formatted;
  // Native table formats can be M/d/yyyy even when the workbook locale is Thai.
  // Read every date column as a numeric serial; keep formatted text/IDs.
  // Match by stable ID so a concurrent sort cannot attach another row's date.
  const numeric = await googleGet<ValuesResponse>(await valuesUrl(range, true));
  const byId = new Map((numeric.values || []).filter(row => row[0]).map(row => [String(row[0]), row]));
  return { values: (formatted.values || []).map(row => {
    if (!row[0]) return row;
    const source = byId.get(String(row[0]));
    if (!source) throw new GoogleSheetsConflictError('ประวัติเปลี่ยนระหว่างอ่าน กรุณาโหลดข้อมูลใหม่');
    const result = [...row];
    for (const index of spec.dates || []) if (typeof source[index] === 'number') result[index] = source[index];
    return result;
  }) };
}

async function getMetadata(): Promise<SpreadsheetMetadata> {
  const spreadsheetId = await getSpreadsheetId();
  return googleGet<SpreadsheetMetadata>(
    'https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(spreadsheetId) +
      '?fields=' +
      encodeURIComponent('properties(title,locale,timeZone),namedRanges(namedRangeId),sheets(properties(sheetId,title,gridProperties(rowCount)),tables(tableId,range,columnProperties))')
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

function normalizeValue(value: unknown, index: number, spec: SheetSpec, locale: string, strictSheetRead = false): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (spec.headers[index] === CONTACT_SEARCH_HEADER &&
    (typeof value === 'boolean' || /^(TRUE|FALSE)$/i.test(String(value).trim()))) {
    return isContactSearchChecked(value) ? 'TRUE' : 'FALSE';
  }
  if (spec.dates?.includes(index)) {
    return toIsoDate(
      value,
      locale,
      spec.key === 'contacts' && (index === 3 || index === 12),
      strictSheetRead
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
  const { metadata } = await cachedReadSnapshot(specs);
  return {
    connected: true,
    mode: 'read-only-check',
    spreadsheetTitle: metadata.properties?.title || '',
    checkedSheets: specs.map(spec => ({ name: spec.sheetName, headerCount: spec.headers.length, headersMatch: true })),
  };
}

async function batchValues(ranges: string[], numeric = false): Promise<ValuesResponse[]> {
  if (!ranges.length) return [];
  const query = new URLSearchParams({ majorDimension: 'ROWS',
    valueRenderOption: numeric ? 'UNFORMATTED_VALUE' : 'FORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  for (const range of ranges) query.append('ranges', range);
  const result = await googleGet<{ valueRanges?: ValuesResponse[] }>(
    'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(await getSpreadsheetId()) + '/values:batchGet?' + query);
  if (result.valueRanges?.length !== ranges.length) throw new Error('Google Sheets returned incomplete ranges');
  return result.valueRanges;
}

async function loadGoogleSheetsSnapshot(specs: SheetSpec[]): Promise<{ data: SheetData; metadata: SpreadsheetMetadata }> {
  const metadata = await getMetadata();
  const sheets = new Map((metadata.sheets || []).map(sheet => [sheet.properties?.title || '', sheet]));
  const active = specs.filter(spec => {
    if (sheets.has(spec.sheetName)) return true;
    if (spec.optional) return false;
    throw new Error('Required Google Sheet tab is missing');
  });
  const ranges = active.map(spec => {
    const rows = sheets.get(spec.sheetName)?.properties?.gridProperties?.rowCount || 1;
    if (rows > MAX_GRID_ROWS) throw new Error('Google Sheet exceeds the safe row limit for a complete read');
    return "'" + spec.sheetName.replace(/'/g, "''") + "'!A1:" + columnName(spec.headers.length) + rows;
  });
  // Headers and records share each range. Date serials remain separate from formatted IDs.
  const formatted = await batchValues(ranges);
  const dated = active.map((spec, index) => ({ spec, index })).filter(({ spec }) => spec.dates?.length);
  const numeric = await batchValues(dated.map(({ index }) => ranges[index]), true);
  const numericByIndex = new Map(dated.map(({ index }, i) => [index, numeric[i]]));
  const data: SheetData = Object.fromEntries(specs.map(spec => [spec.key, []]));
  active.forEach((spec, i) => {
    const raw = formatted[i].values || [];
    if (!headersMatch(raw[0], spec.headers)) throw new GoogleSheetsConflictError('หัวตารางไม่ตรงกับโครงสร้างแอป');
    const numericRows = numericByIndex.get(i)?.values?.slice(1) || [];
    const byId = new Map(numericRows.map(row => [String(row[0] ?? ''), row]));
    data[spec.key] = raw.slice(1).filter(row => row[0] != null && String(row[0]).trim() !== '').map(row => {
      const source = byId.get(String(row[0]));
      if (spec.dates?.length && !source) throw new GoogleSheetsConflictError('ข้อมูลเปลี่ยนระหว่างอ่าน กรุณาลองใหม่');
      const values = spec.headers.map((_, index) => normalizeValue(
        spec.dates?.includes(index) && typeof source?.[index] === 'number' ? source[index] : row[index],
        index, spec, metadata.properties?.locale || 'th_TH', true));
      return { id: String(values[0]), values };
    });
  });
  return { data, metadata };
}

async function readCacheKey(): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await getSpreadsheetId()));
  return 'workbook_' + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function invalidateReadCache(): Promise<void> {
  await invalidateSharedSheetsCache(await readCacheKey());
}
async function cachedReadSnapshot(specs: SheetSpec[]) {
  // The only cached entry is the full UI payload; mutation guards always read Sheets.
  return sharedSheetsRead(await readCacheKey(), () => loadGoogleSheetsSnapshot(specs));
}

export async function loadGoogleSheetsData(specs: SheetSpec[]): Promise<SheetData> {
  return (await loadGoogleSheetsSnapshot(specs)).data;
}

export async function loadGoogleSheetsPayload(specs: SheetSpec[]) {
  const { data, metadata } = await cachedReadSnapshot(specs);
  return {
    ...data,
    _meta: {
      dateNormalization: 'google_serial_v1',
      spreadsheetTitle: metadata.properties?.title || '',
      spreadsheetLocale: metadata.properties?.locale || '',
      spreadsheetTimeZone: metadata.properties?.timeZone || '',
    },
  };
}

export class GoogleSheetsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsConflictError';
  }
}

// The receipt and the append share one atomic Sheets batch. A repeated receipt ID
// makes the whole batch fail, including when requests reach different workers.
async function createGoogleSheetsRecord(
  specs: SheetSpec[],
  part: 'contacts' | 'customers' | 'financials',
  receiptHash: string,
  values: unknown[]
) {
  const spec = specs.find(item => item.key === part);
  if (!spec || !/^[a-f0-9]{64}$/.test(receiptHash)) throw new Error('คำขอสร้างรายการไม่ถูกต้อง');
  const id = String(values[0]);
  const label = part === 'contacts' ? 'ประวัติการติดต่อ' : part === 'customers' ? 'ทะเบียนลูกค้า' : 'งบการเงินรายปี';
  const receiptPart = part === 'contacts' ? 'contact_' : part === 'customers' ? 'customer_' : 'financial_';
  const receiptId = 'crm_' + receiptPart + receiptHash;
  const expected = values.map((value, index) => normalizeValue(value, index, spec, 'th_TH'));
  const findSaved = async () => {
    const rows = ((await loadGoogleSheetsData([spec]))[part] || []).filter(row => row.id === id);
    if (rows.length > 1) throw new GoogleSheetsConflictError('พบรหัสรายการซ้ำใน' + label + ' กรุณาตรวจสอบก่อนสร้างรายการใหม่');
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
    throw new GoogleSheetsConflictError('หัวตาราง' + label + 'ไม่ตรง กรุณาตรวจโครงสร้างชีตก่อนบันทึก');
  }
  if (metadata.namedRanges?.some(item => item.namedRangeId === receiptId)) {
    throw new GoogleSheetsConflictError('คำขอนี้เคยถูกบันทึกแล้ว แต่ไม่พบแถวเดิม กรุณาตรวจ' + label + 'ก่อนสร้างรายการใหม่');
  }
  const table = sheet?.tables?.find(item => (item.range?.startColumnIndex || 0) === 0);
  if (table && table.range?.endColumnIndex !== spec.headers.length) {
    throw new GoogleSheetsConflictError('ตาราง' + label + 'ยังไม่ครอบคลุมทุกคอลัมน์ กรุณาดำเนินการ migration ก่อน');
  }
  if (table && (spec.dates || []).some(index => {
    const type = String(table.columnProperties?.find(column => (column.columnIndex || 0) === index)?.columnType || '');
    return part === 'contacts' ? type !== 'DATE_TIME' : !['DATE', 'DATE_TIME'].includes(type);
  })) throw new GoogleSheetsConflictError('คอลัมน์วันที่ของ' + label + 'ยังไม่พร้อม กรุณาดำเนินการ migration ก่อน');

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
      ? (part === 'contacts'
        ? { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' }
        : { type: 'DATE', pattern: 'yyyy-mm-dd' })
      : spec.numbers?.includes(index)
        ? { type: 'NUMBER', pattern: '#,##0.00' }
        : { type: 'TEXT' };
    return {
      userEnteredValue: typeof input === 'number' ? { numberValue: input } : { stringValue: String(input) },
      userEnteredFormat,
      ...(!table && exemplar[index]?.dataValidation ? { dataValidation: exemplar[index].dataValidation } : {}),
    };
  });
  const requests = [
    { addNamedRange: { namedRange: {
      namedRangeId: receiptId, name: 'CRM_' + (part === 'contacts' ? 'CONTACT_' : part === 'customers' ? 'CUSTOMER_' : 'FINANCIAL_') + receiptHash,
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
    } } },
    { appendCells: {
      sheetId,
      ...(table?.tableId ? { tableId: table.tableId } : {}),
      rows: [{ values: cells }],
      fields: table ? 'userEnteredValue,userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' : 'userEnteredValue,userEnteredFormat,dataValidation',
    } },
  ];
  try {
    const token = await createAccessToken();
    const response = await fetchWithQuotaRetry('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + ':batchUpdate', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    if (!response.ok) throw responseFailure(response, part + '_append_failed', 'write_api');
  } catch (cause) {
    // A response can be lost after commit. Read back this same stable ID; never
    // retry with a fresh ID or write to an existing row as a recovery action.
    const saved = await findSaved();
    if (saved) return { record: saved, created: false, replayed: true };
    throw cause;
  }
  return { record: { id, values: expected }, created: true, replayed: false };
}

async function createGoogleSheetsContactUncached(specs: SheetSpec[], receiptHash: string, values: unknown[]) {
  return createGoogleSheetsRecord(specs, 'contacts', receiptHash, values);
}

async function createGoogleSheetsCustomerUncached(specs: SheetSpec[], receiptHash: string, values: unknown[]) {
  return createGoogleSheetsRecord(specs, 'customers', receiptHash, values);
}

async function createGoogleSheetsFinancialUncached(specs: SheetSpec[], receiptHash: string, values: unknown[]) {
  return createGoogleSheetsRecord(specs, 'financials', receiptHash, values);
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
    response = await fetchWithQuotaRetry(
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
    throw responseFailure(response, reason, 'write_api');
  }
}

async function updateGoogleSheetsRecordUncached(
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
  const currentResponse = await readRecordValues(rowRange, spec);
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

async function deleteGoogleSheetsRecordsUncached(
  specs: SheetSpec[],
  targets: Array<{ key: string; ids: string[] }>
): Promise<void> {
  const requested = targets
    .map(target => ({
      key: target.key,
      ids: [...new Set(target.ids.map(id => String(id).trim()).filter(Boolean))],
    }))
    .filter(target => target.ids.length > 0);
  if (!requested.length) return;

  const metadata = await getMetadata();
  const requests: Array<{
    deleteDimension: {
      range: { sheetId: number; dimension: 'ROWS'; startIndex: number; endIndex: number };
    };
  }> = [];

  for (const target of requested) {
    const spec = specs.find(item => item.key === target.key);
    if (!spec) throw new Error('ไม่พบประเภทข้อมูลที่ต้องการลบ');
    const sheet = (metadata.sheets || []).find(item => item.properties?.title === spec.sheetName);
    const sheetId = sheet?.properties?.sheetId;
    if (!sheet || sheetId === undefined) throw new Error('ไม่พบแท็บ Google Sheets ที่ต้องการลบข้อมูล');
    if (!headersMatch(await readHeader(spec), spec.headers)) {
      throw new GoogleSheetsConflictError('หัวตารางถูกเปลี่ยน กรุณาตรวจโครงสร้างชีตก่อนลบ');
    }

    const rowCount = sheet.properties?.gridProperties?.rowCount || 1;
    const sheetRange = "'" + spec.sheetName.replace(/'/g, "''") + "'";
    const idValues = rowCount > 1
      ? await googleGet<ValuesResponse>(await valuesUrl(sheetRange + '!A2:A' + rowCount))
      : { values: [] };
    const rowsById = new Map<string, number[]>();
    for (const [index, row] of (idValues.values || []).entries()) {
      const id = String(row[0] ?? '');
      if (!id) continue;
      rowsById.set(id, [...(rowsById.get(id) || []), index + 2]);
    }

    const rowNumbers = target.ids.map(id => {
      const matches = rowsById.get(id) || [];
      if (!matches.length) throw new GoogleSheetsConflictError('ไม่พบรายการที่ต้องการลบแล้ว กรุณารีเฟรช');
      if (matches.length > 1) throw new GoogleSheetsConflictError('พบรหัสรายการซ้ำใน Google Sheets จึงหยุดการลบ');
      return matches[0];
    }).sort((a, b) => b - a);

    for (const rowNumber of rowNumbers) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      });
    }
  }

  const token = await createAccessToken();
  let response: Response;
  try {
    response = await fetchWithQuotaRetry(
      'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(await getSpreadsheetId()) + ':batchUpdate',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
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
    throw responseFailure(response, reason, 'write_api');
  }
}


// Invalidation after a mutation also rejects any refresh started before it finished.
async function withCacheInvalidation<T>(operation: () => Promise<T>): Promise<T> {
  await invalidateReadCache();
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); }
      catch (cause) {
        if (!(cause instanceof GoogleSheetsFailure) || cause.category !== 'quota_exceeded' || attempt >= 3 || (cause.retryAfterMs || 0) > 8000) throw cause;
        // Repeat the whole operation so IDs, current row locations, headers and
        // expected values are checked again before any write retry.
        await new Promise(resolve => setTimeout(resolve, Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 1000), cause.retryAfterMs || 0)));
      }
    }
  } finally { await invalidateReadCache(); }
}
export const createGoogleSheetsContact: typeof createGoogleSheetsContactUncached = (...args) =>
  withCacheInvalidation(() => createGoogleSheetsContactUncached(...args));
export const createGoogleSheetsCustomer: typeof createGoogleSheetsCustomerUncached = (...args) =>
  withCacheInvalidation(() => createGoogleSheetsCustomerUncached(...args));
export const createGoogleSheetsFinancial: typeof createGoogleSheetsFinancialUncached = (...args) =>
  withCacheInvalidation(() => createGoogleSheetsFinancialUncached(...args));
export const updateGoogleSheetsRecord: typeof updateGoogleSheetsRecordUncached = (...args) =>
  withCacheInvalidation(() => updateGoogleSheetsRecordUncached(...args));
export const deleteGoogleSheetsRecords: typeof deleteGoogleSheetsRecordsUncached = (...args) =>
  withCacheInvalidation(() => deleteGoogleSheetsRecordsUncached(...args));
