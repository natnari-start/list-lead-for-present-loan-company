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

describe('customer contact-search control', () => {
  it('isolates duplicate company names, persists a confirmed result and recovers from failures/conflicts', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.invalid', pretendToBeVisual: true });
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) {
      Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let root = createRoot(document.getElementById('root'));
    const control = id => document.querySelector(`input[aria-label="${CONTACT_SEARCH_LABEL} · ${id}"]`);
    const click = async node => { assert.ok(node); await act(async () => node.click()); };
    const mount = async () => { await act(async () => root.render(createElement(App))); };
    try {
      await mount();
      assert.equal(control('SYN-UI-001').checked, false);
      let release;
      state.gate = new Promise(resolve => { release = resolve; });
      await click(control('SYN-UI-001'));
      assert.equal(control('SYN-UI-001').checked, true);
      assert.equal(control('SYN-UI-001').disabled, true);
      await click(control('SYN-UI-001'));
      assert.equal(state.calls.length, 1);
      await act(async () => { release(); await state.gate; });
      state.gate = null;
      assert.equal(control('SYN-UI-001').disabled, false);
      assert.equal(control('SYN-UI-002').checked, false);
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.equal(document.querySelector('form'), null);
      assert.equal(state.calls[0].payload.values[flag], 'TRUE');
      assert.equal(state.data.customers[0].values[23], 'Original synthetic note');

      await click([...document.querySelectorAll('button')].find(node => node.textContent === 'รีเฟรช'));
      assert.equal(control('SYN-UI-001').checked, true);
      state.fault = 502;
      await click(control('SYN-UI-001'));
      assert.equal(control('SYN-UI-001').checked, true);
      assert.match(document.querySelector('[role="alert"]').textContent, /Synthetic save failure/);
      assert.equal(document.querySelector('.success-banner'), null);

      state.fault = null;
      state.data.customers[0].values[flag] = 'FALSE';
      state.data.customers[0].values[23] = 'New peer note';
      await click(control('SYN-UI-001'));
      assert.equal(control('SYN-UI-001').checked, false);
      assert.match(document.querySelector('[role="alert"]').textContent, /Synthetic conflict/);
      assert.equal(state.data.customers[0].values[23], 'New peer note');

      await click(control('SYN-UI-001'));
      await click(control('SYN-UI-001'));
      assert.equal(state.data.customers[0].values[flag], 'FALSE');
      await click(document.querySelector('.company-name-button'));
      assert.ok(document.querySelector('[role="dialog"]').textContent.includes(CONTACT_SEARCH_HEADER));
      assert.ok(document.querySelector('[role="dialog"]').textContent.includes('ยังไม่ติ๊ก'));
      await click(document.querySelector('[aria-label="ปิดข้อมูลบริษัท"]'));
      await click(document.querySelector('.row-actions button'));
      assert.equal(document.querySelector('form .contact-search-input').type, 'checkbox');
      assert.ok(document.querySelector('form .company-search-link'));
      await click([...document.querySelectorAll('form button')].find(node => node.textContent === 'ยกเลิก'));

      await act(async () => root.unmount());
      root = createRoot(document.getElementById('root'));
      await mount();
      assert.equal(control('SYN-UI-001').checked, false);
      state.connected = false;
      await act(async () => root.unmount());
      root = createRoot(document.getElementById('root'));
      await mount();
      assert.equal(control('SYN-UI-001').disabled, true);
      assert.match(document.querySelector('.contact-search-state').textContent, /ปิดการแก้ไข/);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      delete globalThis.__contactUi;
    }
  });
});
