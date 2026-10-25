import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { it } from 'node:test';
import { contactIndexes } from '../../src/contact-log.ts';

it('opens outcome-specific fields, reviews local drafts, keeps failed input and retries the same payload', async () => {
  const dom = new JSDOM('<button id="opener">open</button><div id="root"></div>', { url: 'https://synthetic.invalid', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.confirm = () => true;
  let calls = [], fault = false, gate = null, saved = [], closed = 0;
  globalThis.__contactLogUi = { auth: { getUser: async () => ({ userId: 'synthetic-admin' }), signIn: async () => ({}) }, api: {
    get: async () => ({ data: { authorized: true } }),
    post: async (path, body) => { calls.push({ path, body: structuredClone(body) }); if (gate) await gate; if (fault) throw { response: { status: 502, data: { error: 'Synthetic failed write' } } }; return { data: { record: { id: 'SYN-CREATED-CONTACT', values: body.values }, created: true } }; },
  } };
  const bundle = await build({ entryPoints: [new URL('../../src/ContactLogDialog.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', plugins: [{ name: 'fixture', setup(builder) {
    builder.onResolve({ filter: /^@appdeploy\/client$/ }, () => ({ path: 'client', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const api = globalThis.__contactLogUi.api; export const auth = globalThis.__contactLogUi.auth;' }));
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: new URL(args.path === 'react' ? '../../node_modules/react/index.js' : '../../node_modules/react/jsx-runtime.js', import.meta.url).href, external: true }));
  } }] });
  const { default: Dialog } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const customers = [{ id: 'SYN-TEST-CUST-001', values: ['SYN-TEST-CUST-001', null, 'บริษัท ทดสอบชื่อซ้ำ จำกัด'] }, { id: 'SYN-TEST-CUST-002', values: ['SYN-TEST-CUST-002', null, 'บริษัท ทดสอบชื่อซ้ำ จำกัด'] }];
  const cases = [{ id: 'SYN-TEST-CASE-001', values: ['SYN-TEST-CASE-001', 'SYN-TEST-CUST-001'] }, { id: 'SYN-TEST-CASE-002', values: ['SYN-TEST-CASE-002', 'SYN-TEST-CUST-002'] }];
  const field = label => [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label)?.querySelector('input,select,textarea');
  const click = async node => { assert.ok(node); await act(async () => node.click()); };
  const set = async (label, value) => {
    const node = field(label); assert.ok(node, label);
    const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  };
  const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name);
  const submit = async () => act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  try {
    document.getElementById('opener').focus();
    await act(async () => root.render(createElement(Dialog, { customers, cases, context: {}, disabled: false, onClose: () => closed++, onSaved: row => saved.push(row) })));
    assert.equal(document.activeElement, field('บริษัท / รหัสลูกค้า *'));
    await set('วันเวลาที่ติดต่อจริง (เวลาไทย) *', '2026-10-25T09:15');
    await set('บริษัท / รหัสลูกค้า *', 'SYN-TEST-CUST-001');
    assert.equal(field('วันเวลาที่ติดต่อจริง (เวลาไทย) *').value, '2026-10-25T09:15');
    assert.ok(!field('รหัสเคส (ถ้ามี)').textContent.includes('SYN-TEST-CASE-002'));
    await set('รหัสเคส (ถ้ามี)', 'SYN-TEST-CASE-001');
    await set('บริษัท / รหัสลูกค้า *', 'SYN-TEST-CUST-002');
    assert.equal(field('รหัสเคส (ถ้ามี)').value, '');
    await set('บริษัท / รหัสลูกค้า *', 'SYN-TEST-CUST-001');
    await set('ช่องทาง *', 'โทรศัพท์');
    for (const outcome of ['ติดต่อไม่ได้', 'ขอคุยใหม่', 'สนใจ', 'ติดตามสถานะ', 'ไม่สนใจครั้งนี้', 'ขอไม่ให้ติดต่ออีก']) {
      await set('ผลการติดต่อ *', outcome);
      assert.equal(!!field('ข้อตกลงที่ยืนยันแล้ว'), ['ขอคุยใหม่', 'สนใจ', 'ติดตามสถานะ'].includes(outcome));
      assert.equal(!!field('วันเวลาติดต่อกลับ (เวลาไทย ถ้าทราบ)'), outcome === 'ขอคุยใหม่');
      assert.equal(field('รุ่น Sales Sheet ที่ใช้จริง *'), undefined);
      assert.equal(field('รายละเอียดธุรกิจจากการติดต่อ (JSON)'), undefined);
    }
    await set('ผลการติดต่อ *', 'ขอคุยใหม่');
    await set('วันเวลาติดต่อกลับ (เวลาไทย ถ้าทราบ)', '2026-10-26T10:00');
    await click(button('ช่วยร่างบันทึก'));
    assert.equal(field('วันเวลาติดต่อกลับ (เวลาไทย ถ้าทราบ)').value, '2026-10-26T10:00');
    assert.equal(calls.length, 0);
    const preview = document.querySelector('[aria-label="ร่างสำหรับตรวจทาน"]');
    assert.match(preview.textContent, /รอยืนยันจากลูกค้า/);
    assert.doesNotMatch(preview.textContent, /ลูกค้าอนุญาต/);
    await click(button('นำร่างที่ตรวจแล้วไปใช้ในฟอร์ม'));
    assert.match(field('ข้อเสนอแนะ / รอตรวจ').value, /รอยืนยันจากลูกค้า/);
    await set('ผลการติดต่อ *', 'ติดต่อไม่ได้');
    await set('หมายเหตุสั้น (ถ้ามี)', 'ข้อความสังเคราะห์ที่ต้องคงอยู่เมื่อบันทึกล้มเหลว');
    fault = true;
    let release; gate = new Promise(resolve => { release = resolve; });
    await submit(); await submit();
    assert.equal(calls.length, 1);
    assert.equal(button('บันทึกประวัติ'), undefined);
    await act(async () => { release(); await gate; }); gate = null;
    assert.match(document.querySelector('[role="alert"]').textContent, /Synthetic failed write/);
    assert.equal(field('หมายเหตุสั้น (ถ้ามี)').value, 'ข้อความสังเคราะห์ที่ต้องคงอยู่เมื่อบันทึกล้มเหลว');
    assert.equal(saved.length, 0);
    fault = false;
    await submit();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body, calls[1].body);
    const indexes = contactIndexes();
    assert.equal(calls[1].body.values[indexes.contactedAt], '2026-10-25T09:15');
    assert.equal(calls[1].body.values[indexes.agreements], null);
    assert.equal(calls[1].body.values[indexes.salesSheet], null);
    assert.equal(calls[1].body.values[indexes.suggestions], null);
    assert.equal(calls[1].body.values[indexes.businessJson], null);
    assert.equal(saved.length, 1);
    assert.equal(closed, 0);
  } finally {
    await act(async () => root.unmount());
    assert.equal(document.activeElement.id, 'opener');
    dom.window.close(); delete globalThis.__contactLogUi;
  }
});
