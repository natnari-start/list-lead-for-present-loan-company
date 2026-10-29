import assert from 'node:assert/strict';
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
  calls: [], fault: null, gate: null, connected: true,
};
globalThis.__contactUi = {
  auth: { getUser: async () => ({ email: 'admin@example.invalid' }), signOut: async () => {} },
  api: {
    get: async path => ({ data: path === '/api/data' ? structuredClone(state.data) :
      path === '/api/session' ? { authorized: true } : { connected: state.connected, checkedSheets: [{ headersMatch: state.connected }] } }),
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
  },
};
const bundle = await build({
  entryPoints: [new URL('../../src/App.tsx', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
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
const { default: App } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

describe('customer registry essentials', () => {
  it('keeps the compact table focused while preserving contact-search editing in the customer form', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.invalid', pretendToBeVisual: true });
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'InputEvent', 'MouseEvent']) {
      Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let root = createRoot(document.getElementById('root'));
    const click = async node => { assert.ok(node); await act(async () => node.click()); };
    const change = async (node, value) => { assert.ok(node); await act(async () => { node.value = value; node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
    const mount = async () => { await act(async () => root.render(createElement(App))); };
    try {
      dom.window.confirm = () => true;
      await mount();
      const headers = [...document.querySelectorAll('thead th')].map(node => node.textContent);
      assert.deepEqual(headers, ['บริษัท', 'เบอร์โทรศัพท์', 'งบปีล่าสุด', 'เกณฑ์ก่อนติดต่อ', 'การดำเนินการ']);
      assert.ok(document.querySelector('tbody .latest-financial'));
      assert.ok(document.querySelector('tbody .registry-screening'));
      assert.ok(document.body.textContent.includes('ไม่มีเบอร์โทร'));
      assert.ok(document.body.textContent.includes('ยังไม่มีข้อมูลงบ'));
      const summaryValues = [...document.querySelectorAll('.customer-summary-grid strong')].map(node => node.textContent);
      assert.deepEqual(summaryValues, ['3', '1', '1', '1']);
      assert.ok(document.querySelector('[aria-label="เริ่มติดต่อ บริษัท ผ่านเกณฑ์ จำกัด"]'));
      assert.ok(document.querySelector('[aria-label="เพิ่มหรือแก้ไขงบ บริษัท ข้อมูลไม่พอ จำกัด"]'));
      assert.ok(document.querySelector('[aria-label="ดูรายละเอียดเกณฑ์ บริษัท ไม่ผ่านเกณฑ์ จำกัด"]'));
      assert.ok(document.body.textContent.includes('ไม่แนะนำให้ติดต่อ'));
      const firstRowLabels = [...document.querySelectorAll('.customer-registry-table tbody tr:first-child td')].map(node => node.dataset.label);
      assert.deepEqual(firstRowLabels, ['บริษัท', 'เบอร์โทรศัพท์', 'งบปีล่าสุด', 'เกณฑ์ก่อนติดต่อ', 'การดำเนินการ']);
      const filter = document.querySelector('.financial-filter select');
      await change(filter, 'pass');
      assert.equal(document.querySelectorAll('.customer-registry-table tbody tr').length, 1);
      assert.deepEqual([...document.querySelectorAll('.customer-summary-grid strong')].map(node => node.textContent), ['1', '1', '0', '0']);
      await change(filter, 'all');
      assert.equal(document.querySelector(`input[aria-label="${CONTACT_SEARCH_LABEL} · SYN-UI-001"]`), null);
      const firstActions = document.querySelector('tbody tr .row-actions');
      await click([...firstActions.querySelectorAll('button')].find(node => node.textContent === 'แก้ไขทะเบียน'));
      const control = document.querySelector('form .contact-search-input');
      assert.equal(control.checked, false);
      await click(control);
      await click([...document.querySelectorAll('form button')].find(node => node.textContent === 'บันทึกการแก้ไข'));
      assert.equal(state.calls.length, 1);
      assert.equal(state.calls[0].payload.values[flag], 'TRUE');
      assert.equal(state.data.customers[0].values[23], 'Original synthetic note');
      await click(document.querySelector('.company-name-button'));
      const profile = document.querySelector('[role="dialog"]');
      assert.ok(profile.textContent.includes('เลขทะเบียนนิติบุคคล (13 หลัก)'));
      assert.ok(profile.textContent.includes('วันที่จดทะเบียนจัดตั้ง'));
      assert.ok(profile.textContent.includes('รายชื่อผู้เป็นหุ้นส่วน / กรรมการ'));
      assert.ok(profile.textContent.includes('ข้อมูลงบการเงิน'));
      const profileContent = profile.querySelector('.company-profile-content');
      const companyGrid = profile.querySelector('.company-profile-grid');
      const financialSection = profile.querySelector('.company-financial-section');
      assert.ok(profileContent);
      assert.equal(profile.querySelectorAll('.company-profile-content').length, 1);
      assert.ok(companyGrid.compareDocumentPosition(financialSection) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
      assert.equal(document.body.style.overflow, 'hidden');
      const toggle = [...profile.querySelectorAll('button')].find(node => node.textContent === 'ดูข้อมูลงบการเงิน');
      assert.ok(toggle);
      assert.equal(toggle.getAttribute('aria-expanded'), 'false');
      assert.ok(toggle.getAttribute('aria-controls'));
      assert.equal(profile.querySelector('.financial-profile-panel'), null);
      await click(toggle);
      assert.equal(toggle.getAttribute('aria-expanded'), 'true');
      assert.ok(profile.querySelector('.financial-profile-panel'));
      assert.ok([...profile.querySelectorAll('button')].some(node => node.textContent === 'เพิ่ม/แก้ไขงบ'));
      await click(toggle);
      assert.equal(toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(profile.querySelector('.financial-profile-panel'), null);
      await click(document.querySelector('[aria-label="ปิดข้อมูลบริษัท"]'));
      assert.equal(document.body.style.overflow, '');
      await click(document.querySelector('.company-name-button'));
      assert.ok(document.querySelector('[role="dialog"]'));
      await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.equal(document.body.style.overflow, '');
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      delete globalThis.__contactUi;
    }
  });
});
