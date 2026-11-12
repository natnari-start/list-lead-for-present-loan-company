import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../backend/googleSheets.ts', import.meta.url), 'utf8');
const cacheSource = stripTypeScriptTypes(readFileSync(new URL('../backend/sheetsReadCache.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''));
function mockDb() {
 const records = new Map();
 return {records, get: async (_,ids) => ids.map(id => structuredClone(records.get(id) || null)), tx:{
  add: async (_,items) => items.map(item => {if(records.has(item.id))return null;records.set(item.id,structuredClone(item));return item.id;}),
  update: async (_,items,opts={}) => items.map(item => {
   const old=records.get(item.id);if(opts.patch && !old)return false;
   if(item.if && Object.entries(item.if).some(([k,v])=>old?.[k]!==v))return false;
   const next=opts.patch?{...old,...item.record}:{...item.record};
   for(const k of Object.keys(next))if(next[k]===undefined)delete next[k];
   records.set(item.id,structuredClone(next));return true;
  })
 }};
}
function cacheHarness(db, clock) {
 const DateMock=class extends Date {static now(){return clock.now;}};
 return new Function('db','Date',`${cacheSource};return {sharedSheetsRead,invalidateSharedSheetsCache};`)(db,DateMock);
}
function harness({ fetcher, secret = async () => 'synthetic_workbook', clock = { now: 1000 }, db=mockDb() }) {
  const delays = [];
  const text = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''));
  const cache=cacheHarness(db,clock);
  const make = new Function('sharedSheetsRead','invalidateSharedSheetsCache','secrets', 'CONTACT_SEARCH_HEADER', 'isContactSearchChecked', 'contactIndexes', 'toIsoDate', 'fetch', 'setTimeout', 'Date', `${text}\n cachedToken = {value:'synthetic-token', expiresAt:9999999999999}; return {GoogleSheetsFailure, withCacheInvalidation, assertGoogleSheetsConfiguration, loadGoogleSheetsData, loadGoogleSheetsPayload, updateGoogleSheetsRecord, describeGoogleSheetsFailure, getSpreadsheetId, invalidateReadCache, fetchWithQuotaRetry};`);
  return { ...make(cache.sharedSheetsRead,cache.invalidateSharedSheetsCache,{ readSecret: secret, listSecretNames: async () => ['GOOGLE_SPREADSHEET_ID','GOOGLE_SERVICE_ACCOUNT_JSON'] }, 'ค้นหา', Boolean, {}, x => x, fetcher,
    fn => { delays.push(1); fn(); }, class extends Date { static now() { return clock.now; } }), delays, clock };
}

const specs = [{ key: 'customers', sheetName: 'Synthetic', headers: ['id', 'value'], numbers: [1] }];
const metadata = { properties: { locale: 'th_TH' }, sheets: [{ properties: { title: 'Synthetic', sheetId: 1, gridProperties: { rowCount: 10 } } }] };
function sheetsFetch(counter, rows = [['SYN-1', -20]]) {
  return async url => { counter.calls.push(String(url)); return Response.json(String(url).includes('values:batchGet') ? { valueRanges: [{ values: [['id', 'value'], ...rows] }] } : metadata); };
}
test('batch read + concurrent request coalescing + 45s expiry + fresh mutation reads', async () => {
  const count = { calls: [] }; const h = harness({ fetcher: sheetsFetch(count) });
  const [a,b] = await Promise.all([h.loadGoogleSheetsPayload(specs), h.loadGoogleSheetsPayload(specs)]);
  assert.equal(count.calls.length, 2); assert.equal(a.customers[0].values[1], -20);
  a.customers[0].values[1] = 100; assert.equal(b.customers[0].values[1], -20);
  await h.loadGoogleSheetsPayload(specs); assert.equal(count.calls.length, 2);
  await h.loadGoogleSheetsData(specs); assert.equal(count.calls.length, 4);
  h.clock.now += 45001; await h.loadGoogleSheetsPayload(specs); assert.equal(count.calls.length, 6);
  await h.invalidateReadCache(); await h.loadGoogleSheetsPayload(specs); assert.equal(count.calls.length, 8);
});
test('429 retries are bounded and classified separately', async () => {
  let calls = 0; const h = harness({ fetcher: async () => { calls++; return Response.json({error:{status:'RESOURCE_EXHAUSTED'}}, {status:429}); } });
  await assert.rejects(h.loadGoogleSheetsPayload(specs), err => h.describeGoogleSheetsFailure(err).code === 'quota_exceeded');
  assert.equal(calls, 4); assert.equal(h.delays.length, 3);
});
test('permission errors do not retry; failures do not poison read cache', async () => {
  let fail = true; const count = {calls:[]}; const normal = sheetsFetch(count);
  const h = harness({fetcher: async url => fail ? Response.json({error:{status:'PERMISSION_DENIED'}}, {status:403}) : normal(url)});
  await assert.rejects(h.loadGoogleSheetsPayload(specs), err => h.describeGoogleSheetsFailure(err).code === 'permission_denied');
  assert.equal(h.delays.length, 0); fail = false; assert.ok((await h.loadGoogleSheetsPayload(specs)).customers);
});
test('secret read transport failure never claims secret is absent', async () => {
  const h = harness({fetcher: async () => { throw Error('must not call'); }, secret: async () => { throw Error('gateway'); }});
  await assert.rejects(h.getSpreadsheetId(), err => h.describeGoogleSheetsFailure(err).code === 'secret_read_failed');
});
test('long Retry-After returns quota error without retrying early', async () => {
  let calls=0; const h=harness({fetcher:async()=>{calls++; return new Response('',{status:429,headers:{'Retry-After':'60'}});}});
  assert.equal((await h.fetchWithQuotaRetry('synthetic',{})).status,429); assert.equal(calls,1);
});
test('ambiguous network failure is never blindly retried', async()=>{
 let calls=0;const h=harness({fetcher:async()=>{calls++;throw Error('lost response');}});
 await assert.rejects(h.fetchWithQuotaRetry('synthetic',{method:'POST'})); assert.equal(calls,1);
});

test('separate backend instances share the cache and invalidation', async()=>{
 const db=mockDb(),clock={now:1000},count={calls:[]};
 const a=harness({db,clock,fetcher:sheetsFetch(count)}), b=harness({db,clock,fetcher:sheetsFetch(count)});
 await a.loadGoogleSheetsPayload(specs); await b.loadGoogleSheetsPayload(specs);assert.equal(count.calls.length,2);
 await b.invalidateReadCache();await a.loadGoogleSheetsPayload(specs);assert.equal(count.calls.length,4);
});
test('a shared lease coalesces cross-instance loads', async()=>{
 const db=mockDb(),clock={now:1000},count={calls:[]};
 const a=harness({db,clock,fetcher:sheetsFetch(count)}), b=harness({db,clock,fetcher:sheetsFetch(count)});
 await Promise.all([a.loadGoogleSheetsPayload(specs),b.loadGoogleSheetsPayload(specs)]);assert.equal(count.calls.length,2);
});
test('invalidation during an in-flight load prevents stale cache publication', async()=>{
 const db=mockDb(),clock={now:1000};const a=cacheHarness(db,clock),b=cacheHarness(db,clock);let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const pending=a.sharedSheetsRead('synthetic_key',async()=>{await gate;return {old:true};});
 await new Promise(resolve=>setImmediate(resolve));
 await b.invalidateSharedSheetsCache('synthetic_key');release();await pending;
 let loads=0;const next=await b.sharedSheetsRead('synthetic_key',async()=>{loads++;return {old:false};});
 assert.equal(loads,1);assert.equal(next.old,false);
});
test('formatted IDs stay intact while dates use serials; zero/null/negative remain distinct', async()=>{
 const h=harness({fetcher:async url=>{
  if(!String(url).includes('values:batchGet'))return Response.json(metadata);
  const numeric=String(url).includes('UNFORMATTED_VALUE');
  return Response.json({valueRanges:[{values:[['id','value','date'],['000123',numeric?0:'0',numeric?45000:'ambiguous'],['000124',null,null],['000125',-5,null]]}]});
 }});
 const result=await h.loadGoogleSheetsData([{...specs[0],headers:['id','value','date'],dates:[2]}]);
 assert.deepEqual(result.customers.map(r=>r.values),[['000123',0,45000],['000124',null,null],['000125',-5,null]]);
});

test('write quota retries repeat validation operation, not an old HTTP write', async()=>{
 const h=harness({fetcher:async()=>Response.json({})});let validations=0;
 const result=await h.withCacheInvalidation(async()=>{validations++;if(validations<3)throw new h.GoogleSheetsFailure('quota_exceeded',429);return 'saved';});
 assert.equal(result,'saved');assert.equal(validations,3);assert.equal(h.delays.length,2);
});
test('write retry honors a long server cooldown without replay',async()=>{
 const h=harness({fetcher:async()=>Response.json({})});let calls=0;
 await assert.rejects(h.withCacheInvalidation(async()=>{calls++;const err=new h.GoogleSheetsFailure('quota_exceeded',429);err.retryAfterMs=60000;throw err;}));assert.equal(calls,1);
});
