import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { schemas } from '../../src/schema.ts';
import { CONTACT_SEARCH_HEADER, CONTACT_SEARCH_LABEL } from '../../src/contact-search-status.ts';

const spec = schemas.find(item => item.key === 'customers');
const flag = spec.headers.indexOf(CONTACT_SEARCH_HEADER);
const values = spec.headers.map(() => null);
values[0] = 'SYN-UI-001';
values[2] = 'บริษัท ทดสอบชื่อซ้ำ จำกัด';
values[23] = 'Original synthetic note';
const state = {
  data: { customers: [{ id: values[0], values }, { id: 'SYN-UI-002', values: values.map((value, index) => index === 0 ? 'SYN-UI-002' : value) }], cases: [], contacts: [], tasks: [], documents: [] },
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
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) {
      Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let root = createRoot(document.getElementById('root'));
    const click = async node => { assert.ok(node); await act(async () => node.click()); };
    const mount = async () => { await act(async () => root.render(createElement(App))); };
    try {
      dom.window.confirm = () => true;
      await mount();
      const headers = [...document.querySelectorAll('thead th')].map(node => node.textContent);
      assert.deepEqual(headers, ['ชื่อบริษัท', 'เบอร์โทรศัพท์', 'ข้อมูลงบการเงินปีล่าสุด', 'เกณฑ์ก่อนติดต่อ', 'การดำเนินการ']);
      assert.equal(document.querySelector(`input[aria-label="${CONTACT_SEARCH_LABEL} · SYN-UI-001"]`), null);
      const firstActions = document.querySelector('tbody tr .row-actions');
      await click([...firstActions.querySelectorAll('button')].find(node => node.textContent === 'แก้ไข'));
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
      assert.ok([...profile.querySelectorAll('button')].some(node => node.textContent === 'เพิ่ม/แก้ไขงบ'));
      await click(document.querySelector('[aria-label="ปิดข้อมูลบริษัท"]'));
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      delete globalThis.__contactUi;
    }
  });
});
