import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { after, beforeEach, describe, it } from 'node:test';
import { schemas } from '../../src/schema.ts';
import { contactIndexes, contactValues, emptyContactForm } from '../../src/contact-log.ts';

const indexes = contactIndexes();
const initial = Object.fromEntries(schemas.map(spec => [spec.key, []]));
const row = (part, id, cells) => { const spec = schemas.find(item => item.key === part); const values = spec.headers.map(() => null); values[0] = id; for (const [index, value] of Object.entries(cells)) values[+index] = value; return values; };
initial.customers = [row('customers', 'SYN-TEST-CUST-001', { 2: 'บริษัท ทดสอบชื่อซ้ำ จำกัด' }), row('customers', 'SYN-TEST-CUST-002', { 2: 'บริษัท ทดสอบชื่อซ้ำ จำกัด' })];
initial.cases = [row('cases', 'SYN-TEST-CASE-001', { 1: 'SYN-TEST-CUST-001' }), row('cases', 'SYN-TEST-CASE-002', { 1: 'SYN-TEST-CUST-002' })];
initial.contacts = [row('contacts', 'SYN-EXISTING-CONTACT', { 1: 'SYN-TEST-CUST-001', 3: '2026-10-01T10:00:00', 4: 'โทรศัพท์', 6: 'สนใจ', 7: 'Original synthetic history', 14: '{"preserve":true}' })];
let data, receipts, writes, mode, badHeader, reads;
const originalFetch = globalThis.fetch;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
globalThis.__contactLogSdk = {
  readSecret: async name => name === 'ADMIN_EMAILS' ? '["admin@example.invalid"]' : name === 'GOOGLE_SPREADSHEET_ID' ? 'synthetic_test_only' : JSON.stringify({ type: 'service_account', client_email: 'synthetic@example.invalid', private_key: privateKey }),
};
const bundle = await build({ entryPoints: [new URL('../../backend/index.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'sdk-fixture', setup(builder) {
  builder.onResolve({ filter: /^@appdeploy\/sdk$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
    export const secrets = { readSecret: name => globalThis.__contactLogSdk.readSecret(name) };
    export const router = routes => routes;
    export const json = (data, status = 200) => ({ statusCode: status, body: JSON.stringify(data) });
    export const error = (message, status = 500) => json({ error: message }, status);
    export const requireAuth = () => ctx => ctx.user ? undefined : error('unauthorized', 401);
    export const requireAdminEmailAllowlist = emails => ctx => emails.includes(ctx.user?.email?.toLowerCase()) ? undefined : error('forbidden', 403);
  ` }));
} }] });
const { handler } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input); reads++;
  if (url.hostname === 'oauth2.googleapis.com') return response({ access_token: 'synthetic-token', expires_in: 3600 });
  assert.equal(url.hostname, 'sheets.googleapis.com');
  if (url.pathname.endsWith(':batchUpdate')) {
    const body = JSON.parse(options.body);
    assert.equal(body.requests.length, 2);
    const receipt = body.requests[0].addNamedRange.namedRange;
    const append = body.requests[1].appendCells;
    assert.equal(append.sheetId, 3, 'native table append still requires its sheet/grid ID');
    assert.equal(append.tableId, 'synthetic_contacts_table');
    assert.match(receipt.namedRangeId, /^crm_contact_[a-f0-9]{64}$/);
    if (mode === 'deny') return response({}, 403);
    if (receipts.has(receipt.namedRangeId)) return response({ error: 'duplicate receipt' }, 400);
    receipts.add(receipt.namedRangeId);
    writes.push(body);
    const values = append.rows[0].values.map(cell => cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue ?? null);
    for (const index of [indexes.contactedAt, indexes.verifiedAt]) if (typeof values[index] === 'number') values[index] = new Date(Math.round((values[index] - 25569) * 86400000)).toISOString().slice(0, 19);
    data.contacts.push(values.map(value => value === '' ? null : value));
    if (mode === 'lost-response') { mode = ''; throw new Error('Synthetic lost response after commit'); }
    return response({ replies: [{}, {}] });
  }
  if (url.searchParams.has('includeGridData')) return response({ sheets: [{ data: [{ rowData: [{ values: schemas.find(spec => spec.key === 'contacts').headers.map(() => ({ userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 10 }, verticalAlignment: 'MIDDLE' } })) }] }] }] });
  if (!url.pathname.includes('/values/')) return response({ properties: { locale: 'th_TH' }, namedRanges: [...receipts].map(namedRangeId => ({ namedRangeId })), sheets: schemas.map((spec, index) => ({ properties: { sheetId: index + 1, title: spec.sheetName, gridProperties: { rowCount: 1000 } }, ...(spec.key === 'contacts' ? { tables: [{ tableId: 'synthetic_contacts_table', range: { startColumnIndex: 0, endColumnIndex: 15 }, columnProperties: spec.headers.map((_, columnIndex) => ({ columnIndex, columnType: [3, 12].includes(columnIndex) ? 'DATE_TIME' : 'TEXT' })) }] } : {}) })) });
  const range = decodeURIComponent(url.pathname.split('/values/')[1]);
  const spec = schemas.find(item => range.startsWith("'" + item.sheetName + "'!"));
  assert.ok(spec, range);
  if (/!A1:.*1$/.test(range)) return response({ values: [spec.key === 'contacts' && badHeader ? spec.headers.map((header, index) => index === 7 ? 'Changed header' : header) : spec.headers] });
  if (spec.key === 'contacts') {
    return response({ values: data.contacts.map(row => row.map((value, index) => {
      if (![indexes.contactedAt, indexes.verifiedAt].includes(index) || !value) return value;
      if (url.searchParams.get('valueRenderOption') === 'UNFORMATTED_VALUE') return Date.parse(value + 'Z') / 86400000 + 25569;
      const [date, time] = value.split('T'); const [year, month, day] = date.split('-');
      return Number(month) + '/' + Number(day) + '/' + year + ' ' + time;
    })) });
  }
  return response({ values: data[spec.key] });
};
beforeEach(() => { data = structuredClone(initial); receipts = new Set(); writes = []; mode = ''; badHeader = false; reads = 0; });
after(() => { globalThis.fetch = originalFetch; delete globalThis.__contactLogSdk; });
const payload = () => ({ part: 'contacts', requestId: randomUUID(), values: contactValues({ ...emptyContactForm(), customerId: 'SYN-TEST-CUST-001', caseId: 'SYN-TEST-CASE-001', contactedAt: '2026-10-25T09:15', channel: 'โทรศัพท์', outcome: 'ติดต่อไม่ได้' }) });
async function invoke(body, user = { userId: 'synthetic-admin', email: 'admin@example.invalid' }) {
  const ctx = { body, user, params: {}, query: {}, event: {} };
  for (const middleware of handler['POST /api/records']) { const result = await middleware(ctx); if (result) return result; }
}

describe('protected idempotent contact creation', () => {
  it('appends one native row with an atomic receipt, preserves existing histories and replays', async () => {
    const body = payload();
    const created = await invoke(body);
    assert.equal(created.statusCode, 200);
    const saved = JSON.parse(created.body);
    assert.match(saved.record.id, /^CONTACT-[A-F0-9]{32}$/);
    assert.equal(saved.record.values[indexes.contactedAt], '2026-10-25T09:15:00');
    assert.deepEqual(data.contacts[0], initial.contacts[0]);
    assert.equal((await invoke(body)).statusCode, 200);
    assert.equal(JSON.parse((await invoke(body)).body).record.values[indexes.contactedAt], '2026-10-25T09:15:00', 'native M/d/yyyy display must not break replay under a Thai locale');
    assert.equal(writes.length, 1);
    assert.equal(data.contacts.length, 2);
    assert.deepEqual(data.customers, initial.customers);
    assert.deepEqual(data.cases, initial.cases);
    const changed = structuredClone(body); changed.values[indexes.facts] = 'Changed draft';
    assert.equal((await invoke(changed)).statusCode, 409);
    assert.equal(writes.length, 1);
  });
  it('handles concurrent duplicate requests and a response lost after commit without a second append', async () => {
    const body = payload();
    const pair = await Promise.all([invoke(body), invoke(body)]);
    assert.deepEqual(pair.map(item => item.statusCode), [200, 200]);
    assert.equal(writes.length, 1);
    mode = 'lost-response';
    const lost = await invoke(payload());
    assert.equal(lost.statusCode, 200);
    assert.equal(JSON.parse(lost.body).replayed, true);
    assert.equal(writes.length, 2);
    assert.equal(data.contacts.length, 3);
  });
  it('denies unauthorized users, invalid relationships, options, dates, JSON and caller-supplied IDs', async () => {
    assert.equal((await invoke(payload(), null)).statusCode, 401);
    assert.equal((await invoke(payload(), { userId: 'other', email: 'other@example.invalid' })).statusCode, 403);
    assert.equal(reads, 0);
    for (const [index, value] of [[indexes.customerId, 'MISSING'], [indexes.caseId, 'SYN-TEST-CASE-002'], [indexes.contactedAt, '2026-02-30T10:00'], [indexes.channel, 'invalid'], [indexes.businessJson, '{}'], [indexes.id, 'CALLER-ID']]) {
      const body = payload(); body.values[index] = value;
      assert.equal((await invoke(body)).statusCode, 400);
    }
    assert.equal((await invoke({ ...payload(), part: 'customers' })).statusCode, 405);
    assert.equal(writes.length, 0);
  });
  it('leaves existing data intact on permission/header failures and stores formula-like text literally', async () => {
    mode = 'deny';
    assert.equal((await invoke(payload())).statusCode, 403);
    assert.equal(writes.length, 0);
    mode = ''; badHeader = true;
    assert.notEqual((await invoke(payload())).statusCode, 200);
    assert.equal(writes.length, 0);
    badHeader = false;
    const body = payload(); body.values[indexes.facts] = '=SUM(1,2)';
    assert.equal((await invoke(body)).statusCode, 200);
    assert.equal(writes[0].requests[1].appendCells.rows[0].values[indexes.facts].userEnteredValue.stringValue, '=SUM(1,2)');
    assert.deepEqual(data.contacts[0], initial.contacts[0]);
  });
});
