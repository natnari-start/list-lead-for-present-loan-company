import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { build } from 'esbuild';
import { after, describe, it } from 'node:test';
import { schemas } from '../../src/schema.ts';
import { contactSearchUpdate } from '../../src/contact-search-status.ts';

const customer = schemas.find(spec => spec.key === 'customers');
const flag = customer.headers.length - 1;
const initial = customer.headers.map(() => null);
initial[0] = 'SYN-TEST-CUST-001';
initial[1] = '2026-10-01';
initial[2] = 'บริษัท ทดสอบ จำกัด';
initial[16] = 'ลูกค้าติดต่อเอง';
initial[19] = 'ใช้งาน';
initial[22] = '2026-10-01';
initial[23] = 'Synthetic note';
const originalFetch = globalThis.fetch;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
let row = [...initial];
let actualHeaders = [...customer.headers];
let writes = [];
globalThis.__contactSdk = {
  readSecret: async name => name === 'ADMIN_EMAILS' ? '["admin@example.invalid"]' :
    name === 'GOOGLE_SPREADSHEET_ID' ? 'synthetic_test_only' :
      JSON.stringify({ type: 'service_account', client_email: 'synthetic@example.invalid', private_key: privateKey }),
};
const bundle = await build({
  entryPoints: [new URL('../../backend/index.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'sdk-test-double', setup(builder) {
    builder.onResolve({ filter: /^@appdeploy\/sdk$/ }, () => ({ path: 'sdk', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export const secrets = { readSecret: name => globalThis.__contactSdk.readSecret(name) };
      export const router = routes => routes;
      export const requireAuth = () => context => context.user ? undefined : error('unauthorized', 401);
      export const json = (data, status = 200) => ({ statusCode: status, body: JSON.stringify(data) });
      export const error = (message, status = 500) => json({ error: message }, status);
    ` }));
  } }],
});
const { handler } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.hostname === 'oauth2.googleapis.com') return response({ access_token: 'synthetic-token', expires_in: 3600 });
  if (url.hostname !== 'sheets.googleapis.com') throw new Error('Unexpected network target');
  if (url.pathname.endsWith('/values:batchUpdate')) {
    const body = JSON.parse(options.body);
    writes.push(body);
    const next = body.data[0].values[0][0];
    assert.equal(typeof next, 'boolean');
    assert.deepEqual(body.data, [{ range: "'ทะเบียนลูกค้า'!BA2:BA2", majorDimension: 'ROWS', values: [[next]] }]);
    row[flag] = next;
    return response({});
  }
  if (!url.pathname.includes('/values/')) return response({ properties: { locale: 'th_TH' }, sheets: schemas.map(spec => ({ properties: { title: spec.sheetName, gridProperties: { rowCount: 10 } } })) });
  const range = decodeURIComponent(url.pathname.split('/values/')[1]);
  const spec = schemas.find(item => range.startsWith("'" + item.sheetName + "'!"));
  if (range.includes('1:') && range.endsWith('1')) return response({ values: [spec.key === 'customers' ? actualHeaders : spec.headers] });
  if (spec.key !== 'customers') return response({ values: [] });
  if (range.endsWith('!A2:A10')) return response({ values: [[row[0]]] });
  return response({ values: [row] });
};
after(() => { globalThis.fetch = originalFetch; delete globalThis.__contactSdk; });

async function invoke(payload, user = { userId: 'synthetic-admin', email: 'admin@example.invalid' }) {
  const context = { body: payload, params: { part: 'customers', id: initial[0] }, query: {}, event: {}, user };
  for (const middleware of handler['PUT /api/records/:part/:id']) {
    const result = await middleware(context);
    if (result) return result;
  }
}

describe('protected contact-search writes', () => {
  it('writes one Boolean cell and round-trips normalized TRUE without changing other fields', async () => {
    row = [...initial]; actualHeaders = [...customer.headers]; writes = [];
    const result = await invoke(contactSearchUpdate(customer.headers, { id: row[0], values: row }, true));
    assert.equal(result.statusCode, 200);
    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(result.body).data.customers[0].values[flag], 'TRUE');
    assert.deepEqual(row.slice(0, flag), initial.slice(0, flag));
    const saved = JSON.parse(result.body).data.customers[0];
    const removed = await invoke(contactSearchUpdate(customer.headers, saved, false));
    assert.equal(removed.statusCode, 200);
    assert.equal(writes.length, 2);
    assert.equal(row[flag], false);
    assert.equal(JSON.parse(removed.body).data.customers[0].values[flag], 'FALSE');
  });

  it('rejects stale rows and invalid values without writing', async () => {
    row = [...initial]; writes = [];
    const payload = contactSearchUpdate(customer.headers, { id: row[0], values: row }, true);
    row[23] = 'Peer changed this note';
    assert.equal((await invoke(payload)).statusCode, 409);
    assert.equal(writes.length, 0);
    payload.values[flag] = 'YES';
    assert.equal((await invoke(payload)).statusCode, 400);
    payload.values[flag] = true;
    assert.equal((await invoke(payload)).statusCode, 400);
    assert.equal(writes.length, 0);
  });

  it('denies anonymous and non-admin identities before any sheet write', async () => {
    writes = [];
    const payload = contactSearchUpdate(customer.headers, { id: initial[0], values: initial }, true);
    assert.equal((await invoke(payload, null)).statusCode, 401);
    assert.equal((await invoke(payload, { userId: 'other', email: 'other@example.invalid' })).statusCode, 403);
    assert.equal(writes.length, 0);
  });
});
