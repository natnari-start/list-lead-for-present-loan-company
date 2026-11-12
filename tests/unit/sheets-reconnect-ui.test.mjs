import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { schemas } from '../../src/schema.ts';
import { CONTACT_SEARCH_HEADER, CONTACT_SEARCH_LABEL } from '../../src/contact-search-status.ts';
import { financialSchema } from '../../src/financial-screening.ts';

const spec = schemas.find(item => item.key === 'customers');
const flag = spec.headers.indexOf(CONTACT_SEARCH_HEADER);
const customerValues = (id, name, phone = '', registration = '') => {
  const row = spec.headers.map(() => null);
  row[0] = id;
  row[spec.headers.indexOf('ชื่อบริษัท')] = name;
  row[spec.headers.indexOf('เบอร์โทรศัพท์')] = phone;
  row[spec.headers.indexOf('เลขทะเบียนนิติบุคคล (13 หลัก)')] = registration;
  row[23] = 'Original synthetic note';
  return row;
};
const values = customerValues('SYN-UI-001', 'บริษัท ผ่านเกณฑ์ จำกัด', '081-111-1111', '0100000000001');
const financialIndexes = Object.fromEntries(financialSchema.headers.map((header, index) => [header, index]));
const financialRow = (customerId, year, profit, interest = 4, revenue = 100) => {
  const row = financialSchema.headers.map(() => null);
  const id = `FIN-${customerId}-${year}`;
  row[financialIndexes['รหัสงบการเงิน']] = id;
  row[financialIndexes['รหัสลูกค้า']] = customerId;
  row[financialIndexes['ปีงบ (ค.ศ.)']] = year;
  row[financialIndexes['รายได้รวม (บาท)']] = revenue;
  row[financialIndexes['กำไรสุทธิ (บาท)']] = profit;
  row[financialIndexes['ดอกเบี้ยจ่าย (บาท)']] = interest;
  return { id, values: row };
};
const state = {
  data: {
    customers: [
      { id: values[0], values },
      { id: 'SYN-UI-002', values: customerValues('SYN-UI-002', 'บริษัท ข้อมูลไม่พอ จำกัด') },
      { id: 'SYN-UI-003', values: customerValues('SYN-UI-003', 'บริษัท ไม่ผ่านเกณฑ์ จำกัด', '081-333-3333') },
    ],
    financials: [
      financialRow('SYN-UI-001', 2025, 10),
      financialRow('SYN-UI-003', 2025, -10),
      financialRow('SYN-UI-003', 2024, -10),
      financialRow('SYN-UI-003', 2023, -10),
    ],
    cases: [], contacts: [], tasks: [], documents: [],
  },
  getCalls: [], dataFault: false, calls: [], deleteCalls: [], fault: null, gate: null, connected: true,
};
globalThis.__contactUi = {
  auth: { getUser: async () => ({ email: 'admin@example.invalid' }), signOut: async () => {} },
  api: {
    get: async path => {
      state.getCalls.push(path);
      if (path === '/api/data' && state.dataFault) throw { response: { status:429, data:{error:'Google Sheets เกินโควตา'} } };
      return {data:path === '/api/data' ? structuredClone(state.data) : {authorized:true}};
    },
    put: async (path, payload) => {
      state.calls.push({ path, payload: structuredClone(payload) });
      if (state.gate) await state.gate;
      const id = decodeURIComponent(path.split('/').at(-1));
      const row = state.data.customers.find(item => item.id === id);
      if (state.fault || JSON.stringify(payload.expectedValues) !== JSON.stringify(row.values)) {
        throw { response: { status: state.fault || 409, data: { error: state.fault ? 'Synthetic save failure' : 'Synthetic conflict: reload required' } } };
      }
      row.values = [...payload.values];
      return { data: { data: structuredClone(state.data), updated: true } };
    },
    delete: async path => {
      state.deleteCalls.push(path);
      const id = decodeURIComponent(path.split('/').at(-1));
      const deletedFinancials = state.data.financials.filter(item => item.values[financialIndexes['รหัสลูกค้า']] === id).length;
      state.data.customers = state.data.customers.filter(item => item.id !== id);
      state.data.financials = state.data.financials.filter(item => item.values[financialIndexes['รหัสลูกค้า']] !== id);
      return { data: { data: structuredClone(state.data), deleted: true, deletedFinancials } };
    },
  },
};
const bundle = await build({
  entryPoints: [new URL('../../src/App.tsx', import.meta.url).pathname],
  packages: 'external', bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
  loader: { '.css': 'empty' },
  plugins: [{ name: 'ui-fixture', setup(builder) {
    builder.onResolve({ filter: /^@appdeploy\/client$/ }, () => ({ path: 'client', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const api = globalThis.__contactUi.api; export const auth = globalThis.__contactUi.auth;' }));
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({
      path: new URL(args.path === 'react' ? '../../node_modules/react/index.js' : '../../node_modules/react/jsx-runtime.js', import.meta.url).href,
      external: true,
    }));
  } }],
});
writeFileSync(new URL('./ui-test-bundle.mjs', import.meta.url), bundle.outputFiles[0].text);
const { default: App } = await import('./ui-test-bundle.mjs');

describe('Google Sheets reconnect', () => {
 it('keeps authentication and draft input, avoids duplicate loads and duplicate saves', async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid',pretendToBeVisual:true});
  for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','InputEvent','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const root=createRoot(document.getElementById('root'));
  const click=async node=>{assert.ok(node);await act(async()=>node.click());};
  try{
   dom.window.confirm=()=>true;
   await act(async()=>root.render(createElement(App)));
   assert.equal(state.getCalls.filter(p=>p==='/api/data').length,1);
   assert.equal(state.getCalls.filter(p=>p.includes('/status')).length,0);
   await click(document.querySelector('[aria-label="แก้ไขทะเบียน บริษัท ผ่านเกณฑ์ จำกัด"]'));
   const control=document.querySelector('form .contact-search-input');await click(control);assert.equal(control.checked,true);
   state.dataFault=true;
   await click([...document.querySelectorAll('button')].find(n=>n.textContent.includes('รีเฟรช')));
   assert.ok(document.querySelector('.app-shell'));assert.equal(document.querySelector('form .contact-search-input').checked,true);
   assert.ok(document.body.textContent.includes('เกินโควตา'));
   state.dataFault=false;
   await click([...document.querySelectorAll('form button')].find(n=>n.textContent==='ลองเชื่อมต่อใหม่'));
   assert.equal(document.querySelector('form .contact-search-input').checked,true);
   let release;state.gate=new Promise(resolve=>{release=resolve;});
   const form=document.querySelector('form');
   await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
   assert.equal(state.calls.length,1);
   await act(async()=>{release();await state.gate;});
   assert.equal(document.querySelector('form'),null);
   assert.equal(state.data.customers[0].values[flag],'TRUE');
  }finally{await act(async()=>root.unmount());dom.window.close();}
 });
});
