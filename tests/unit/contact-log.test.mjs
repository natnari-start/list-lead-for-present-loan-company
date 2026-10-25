import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bangkokDateTime, contactIndexes, contactSpec, contactValues, draftContact, emptyContactForm, isContactDateTime, validateContactValues } from '../../src/contact-log.ts';

const indexes = contactIndexes();
const example = () => ({ ...emptyContactForm(), customerId: 'SYN-TEST-CUST-001', contactedAt: '2026-10-25T09:15', channel: 'โทรศัพท์', outcome: 'สนใจ', facts: 'ข้อมูลสังเคราะห์ที่พนักงานกรอก' });

describe('contact log mapping and local drafting', () => {
  it('uses Bangkok wall time across UTC day boundaries and validates real calendar dates', () => {
    assert.equal(bangkokDateTime(new Date('2026-10-24T18:05:00Z')), '2026-10-25T01:05');
    assert.equal(isContactDateTime('2026-02-30T10:00'), false);
    assert.equal(isContactDateTime('2028-02-29T10:00'), true);
    assert.equal(isContactDateTime('2026-10-25T24:00'), false);
  });
  it('maps by header, keeps a backend-created ID blank and adds no schema columns', () => {
    const form = example();
    const headers = [...contactSpec.headers].reverse();
    const values = contactValues(form, headers);
    assert.equal(values.length, 15);
    assert.equal(values[headers.indexOf('รหัสลูกค้า')], form.customerId);
    assert.equal(values[headers.indexOf('รหัสบันทึก')], null);
    assert.equal(values[headers.indexOf('รายละเอียดธุรกิจจากการติดต่อ (JSON)')], null);
  });
  it('keeps hidden agreements, sales and suggestions out of short-outcome saves', () => {
    for (const outcome of ['ติดต่อไม่ได้', 'ไม่สนใจครั้งนี้', 'ขอไม่ให้ติดต่ออีก']) {
      const values = contactValues({ ...example(), outcome, facts: '', agreements: 'hidden draft', suggestions: 'hidden idea', productPresented: true, salesSheet: 'NOT-PRESENTED' });
      assert.equal(validateContactValues(values), '');
      assert.equal(values[indexes.facts], 'ผลการติดต่อ: ' + outcome);
      for (const key of ['agreements', 'suggestions', 'salesSheet']) assert.equal(values[indexes[key]], null);
    }
  });
  it('does not invent permission and makes repeated draft application idempotent', () => {
    const form = { ...example(), outcome: 'ขอคุยใหม่', callbackAt: '2026-10-26T10:00', callbackChannel: 'โทรศัพท์' };
    let draft = draftContact(form);
    assert.equal(draft.agreements, '');
    assert.match(draft.suggestions, /รอยืนยันจากลูกค้า/);
    assert.doesNotMatch(draft.agreements, /อนุญาต/);
    draft = draftContact({ ...form, callbackAllowed: true });
    assert.match(draft.agreements, /พนักงานระบุว่าลูกค้าอนุญาต/);
    assert.deepEqual(draftContact({ ...form, callbackAllowed: true, ...draft }), draft);
    assert.equal(draftContact({ ...example(), facts: '' }).facts, '');
    assert.doesNotMatch(draft.facts, /บริษัท ทดสอบ เอสเอ็มอี/);
  });
  it('rejects malformed timestamps, options and raw JSON without confusing blanks with consent', () => {
    const values = contactValues(example());
    assert.equal(validateContactValues(values), '');
    values[indexes.contactedAt] = '2026-02-30T10:00';
    assert.match(validateContactValues(values), /วันเวลา/);
    values[indexes.contactedAt] = '2026-10-25T10:00';
    values[indexes.channel] = 'unapproved-channel';
    assert.match(validateContactValues(values), /ไม่อยู่ในรายการ/);
    values[indexes.channel] = 'โทรศัพท์';
    values[indexes.businessJson] = '{"unexpected":true}';
    assert.match(validateContactValues(values), /JSON/);
    assert.equal(emptyContactForm().callbackAllowed, false);
    assert.equal(emptyContactForm().verify, 'ยังไม่ตรวจ');
  });
  it('rebuilds only generated callback lines when permission or appointment changes', () => {
    const form = { ...example(), outcome: 'ขอคุยใหม่', callbackAt: '2026-10-26T10:00', callbackChannel: 'โทรศัพท์', callbackAllowed: true, agreements: 'ข้อตกลงที่พนักงานกรอกเอง' };
    const applied = { ...form, ...draftContact(form) };
    const removed = draftContact({ ...applied, callbackAllowed: false });
    assert.equal(removed.agreements, 'ข้อตกลงที่พนักงานกรอกเอง');
    assert.doesNotMatch(removed.agreements, /อนุญาต/);
    assert.match(removed.suggestions, /รอยืนยัน/);
    const changed = draftContact({ ...applied, callbackAt: '2026-10-27T11:00' });
    assert.doesNotMatch(changed.agreements, /2026-10-26/);
    assert.match(changed.agreements, /2026-10-27 11:00/);
  });
});

