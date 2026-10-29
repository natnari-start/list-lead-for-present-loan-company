import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { build } from 'esbuild';
import { after, beforeEach, describe, it } from 'node:test';
import { schemas } from '../../src/schema.ts';
import { financialSchema } from '../../src/financial-screening.ts';

const specs = [...schemas, financialSchema];
const makeRow = (key, id, cells = {}) => {
  const spec = specs.find(item => item.key === key);
  const values = spec.headers.map(() => null);
  values[0] = id;
  for (const [index, value] of Object.entries(cells)) values[Number(index)] = value;
  return values;
};
const baseData = () => Object.fromEntries(specs.map(spec => [spec.key, []]));
let data;
let batchWrites;
const originalFetch = globalThis.fetch;
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
globalThis.__customerDeleteSdk = {
  readSecret: async name => name === 'ADMIN_EMAILS' ? '["admin@example.invalid"]' :
    name === 'GOOGLE_SPREADSHEET_ID' ? 'synthetic_test_only' :
      JSON.stringify({ type: 'service_account', client_email: 'synthetic@example.invalid', private_key: privateKey }),
};

const bundle = await build({
  entryPoints: [new URL('../../backend/index.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [{ name: 'sdk-fixture', setup(builder) {
    builder.onResolve({ filter: /^@appdeploy\/sdk$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const secrets = { readSecret: name => globalThis.__customerDeleteSdk.readSecret(name) };
      export const router = routes => routes;
      export const json = (data, status = 200) => ({ statusCode: status, body: JSON.stringify(data) });
      export const error = (message, status = 500) => json({ error: message }, status);
      export const requireAuth = () => ctx => ctx.user ? undefined : error('unauthorized', 401);
    ` }));
  } }],
});
const { handler } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.hostname === 'oauth2.googleapis.com') return response({ access_token: 'synthetic-token', expires_in: 3600 });
  assert.equal(url.hostname, 'sheets.googleapis.com');
  if (url.pathname.endsWith(':batchUpdate')) {
    const body = JSON.parse(options.body);
    batchWrites.push(body);
    for (const request of body.requests) {
      const range = request.deleteDimension.range;
      const spec = specs.find((_, index) => index + 1 === range.sheetId);
      const dataIndex = range.startIndex - 1;
      data[spec.key].splice(dataIndex, range.endIndex - range.startIndex);
    }
    return response({ replies: body.requests.map(() => ({})) });
  }
  if (!url.pathname.includes('/values/')) {
    return response({
      properties: { locale: 'th_TH' },
      sheets: specs.map((spec, index) => ({
        properties: { sheetId: index + 1, title: spec.sheetName, gridProperties: { rowCount: 20 } },
      })),
    });
  }
  const range = decodeURIComponent(url.pathname.split('/values/')[1]);
  const spec = specs.find(item => range.startsWith("'" + item.sheetName + "'!"));
  assert.ok(spec, range);
  if (/!A1:.*1$/.test(range)) return response({ values: [spec.headers] });
  if (/!A2:A\d+$/.test(range)) return response({ values: data[spec.key].map(row => [row[0]]) });
  return response({ values: data[spec.key] });
};

beforeEach(() => {
  data = baseData();
  data.customers = [makeRow('customers', 'SYN-DELETE-001', { 2: 'บริษัท ลบทดสอบ จำกัด' })];
  data.financials = [
    makeRow('financials', 'FIN-2025', { 1: 'SYN-DELETE-001', 2: 2025, 3: 100, 4: 10, 5: 1 }),
    makeRow('financials', 'FIN-2024', { 1: 'SYN-DELETE-001', 2: 2024, 3: 100, 4: 10, 5: 1 }),
  ];
  batchWrites = [];
});
after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__customerDeleteSdk;
});

async function invoke(id = 'SYN-DELETE-001', user = { userId: 'synthetic-admin', email: 'admin@example.invalid' }, part = 'customers') {
  const context = { body: null, params: { part, id }, query: {}, event: {}, user };
  for (const middleware of handler['DELETE /api/records/:part/:id']) {
    const result = await middleware(context);
    if (result) return result;
  }
}

describe('protected company deletion', () => {
  it('atomically deletes an unreferenced company and its financial rows, then safely replays', async () => {
    const result = await invoke();
    assert.equal(result.statusCode, 200);
    const saved = JSON.parse(result.body);
    assert.equal(saved.deleted, true);
    assert.equal(saved.deletedFinancials, 2);
    assert.equal(saved.data.customers.length, 0);
    assert.equal(saved.data.financials.length, 0);
    assert.equal(batchWrites.length, 1);
    assert.equal(batchWrites[0].requests.length, 3);
    assert.deepEqual(batchWrites[0].requests.map(request => request.deleteDimension.range.sheetId), [6, 6, 1]);
    assert.deepEqual(batchWrites[0].requests.slice(0, 2).map(request => request.deleteDimension.range.startIndex), [2, 1]);

    const replay = await invoke();
    assert.equal(replay.statusCode, 200);
    assert.equal(JSON.parse(replay.body).replayed, true);
    assert.equal(batchWrites.length, 1);
  });

  it('blocks deletion when cases, contacts, or tasks still reference the company', async () => {
    data.cases.push(makeRow('cases', 'CASE-001', { 1: 'SYN-DELETE-001' }));
    data.contacts.push(makeRow('contacts', 'CONTACT-001', { 1: 'SYN-DELETE-001' }));
    data.tasks.push(makeRow('tasks', 'TASK-001', { 1: 'SYN-DELETE-001' }));
    const result = await invoke();
    assert.equal(result.statusCode, 409);
    assert.match(JSON.parse(result.body).error, /เคส 1, ประวัติติดต่อ 1, งานติดตาม 1/);
    assert.equal(data.customers.length, 1);
    assert.equal(data.financials.length, 2);
    assert.equal(batchWrites.length, 0);
  });

  it('denies anonymous and non-admin users and rejects deletion of other record types', async () => {
    assert.equal((await invoke('SYN-DELETE-001', null)).statusCode, 401);
    assert.equal((await invoke('SYN-DELETE-001', { userId: 'other', email: 'other@example.invalid' })).statusCode, 403);
    assert.equal((await invoke('SYN-DELETE-001', { userId: 'synthetic-admin', email: 'admin@example.invalid' }, 'contacts')).statusCode, 405);
    assert.equal(batchWrites.length, 0);
  });
});
