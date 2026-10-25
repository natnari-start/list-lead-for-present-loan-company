import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeBusinessJson, QUALITY_CRITERIA } from '../../src/contact-business.ts';
import { contactIndexes, contactValues, draftContact, emptyContactForm, validateContactValues } from '../../src/contact-log.ts';

const ix = contactIndexes();
const example = () => ({ ...emptyContactForm(), customerId: 'SYN-TEST-CUST-001', contactedAt: '2026-10-25T09:15', channel: 'โทรศัพท์', outcome: 'สนใจ', facts: 'ลูกค้าแจ้งข้อมูลสังเคราะห์' });
describe('structured contact data without column migration', () => {
  it('keeps missing answers unknown and quality optional without blocking a failed employee observation', () => {
    const form = example();
    assert.ok(QUALITY_CRITERIA.every(([key]) => form.quality[key] === 'ยังไม่ทราบ'));
    assert.equal(contactValues(form)[ix.businessJson], null);
    form.fundingPlan = 'มีแผน';
    form.questionsAsked = true;
    form.answers.monthlySales = 'ยอดขายตัวอย่าง 123 บาท — ลูกค้าแจ้ง';
    form.quality.businessAge = 'ไม่ผ่านตามที่พนักงานเห็น';
    form.qualityNote = 'อายุธุรกิจยังรอยืนยันคู่มือ 6/8 ปี';
    form.documentStage = 'ขอ Prescreen';
    const values = contactValues(form);
    assert.equal(validateContactValues(values), '');
    assert.equal(values.length, 15);
    const data = JSON.parse(values[ix.businessJson]).crmContactV1;
    assert.deepEqual(Object.keys(data.answers), ['monthlySales']);
    assert.equal(data.quality.businessAge, 'ไม่ผ่านตามที่พนักงานเห็น');
    assert.equal(data.quality.entity, 'ยังไม่ทราบ');
    assert.equal(data.documentStage, 'ขอ Prescreen');
  });
  it('preserves unrelated legacy JSON and refuses to overwrite an existing namespace or invalid shape', () => {
    const original = '{"synthetic":true,"testOnly":true,"other":{"keep":1}}';
    const data = { version: 1, fundingPlan: 'ยังไม่ทราบ' };
    const merged = JSON.parse(mergeBusinessJson(original, data));
    assert.deepEqual(merged.other, { keep: 1 });
    assert.equal(merged.testOnly, true);
    assert.equal(mergeBusinessJson(original, null), original);
    assert.throws(() => mergeBusinessJson('{"crmContactV1":{"version":1}}', data));
    assert.throws(() => mergeBusinessJson('[]', data));
    assert.throws(() => mergeBusinessJson('bad-json', data));
  });
  it('uses only entered answers in drafts and never regenerates text on save', () => {
    const form = example();
    form.fundingPlan = 'มีแผน';
    form.questionsAsked = true;
    form.answers.businessType = 'บริการทดสอบ — ลูกค้าแจ้ง';
    const draft = draftContact(form);
    assert.match(draft.facts, /^แผนใช้เงิน: มีแผน/);
    assert.match(draft.facts, /บริการทดสอบ/);
    assert.doesNotMatch(draft.facts, /ยอดขาย|อนุญาต|ผ่านเกณฑ์|ดอกเบี้ย|5 ล้านบาท/);
    assert.equal(contactValues(form)[ix.facts], form.facts);
    const edited = { ...form, ...draft, facts: 'ร่างที่พนักงานแก้แล้วเท่านั้น' };
    assert.equal(contactValues(edited)[ix.facts], edited.facts);
    assert.equal(contactValues(edited)[ix.agreements], null);
  });
  it('rebuilds generated plan/answer lines without stale duplicates while retaining free text', () => {
    const form = example();
    form.fundingPlan = 'มีแผน';
    form.questionsAsked = true;
    form.answers.monthlySales = '123 บาท';
    const applied = { ...form, ...draftContact(form) };
    assert.deepEqual(draftContact(applied), draftContact(form));
    applied.fundingPlan = 'ยังไม่ทราบ';
    applied.answers.monthlySales = '456 บาท';
    const changed = draftContact(applied);
    assert.doesNotMatch(changed.facts, /123 บาท|แผนใช้เงิน: มีแผน/);
    assert.match(changed.facts, /^แผนใช้เงิน: ยังไม่ทราบ/);
    assert.match(changed.facts, /456 บาท/);
    assert.match(changed.facts, /ลูกค้าแจ้งข้อมูลสังเคราะห์/);
  });
  it('omits all hidden business data for short outcomes and rejects hidden data at the backend boundary', () => {
    const form = example();
    form.questionsAsked = true;
    form.answers.currentLoans = 'ข้อมูลที่ไม่ควรถูกส่ง';
    form.documentStage = 'ขอ Full Doc';
    form.fundingPlan = 'มีแผน';
    for (const outcome of ['ติดต่อไม่ได้', 'ไม่สนใจครั้งนี้', 'ขอไม่ให้ติดต่ออีก']) {
      const values = contactValues({ ...form, outcome });
      assert.equal(values[ix.businessJson], null);
      assert.equal(validateContactValues(values), '');
      values[ix.businessJson] = '{"crmContactV1":{"version":1,"documentStage":"ขอ Full Doc"}}';
      assert.match(validateContactValues(values), /JSON/);
    }
    const values = contactValues({ ...form, outcome: 'ขอไม่ให้ติดต่ออีก' });
    values[ix.agreements] = 'ติดตามขาย';
    assert.match(validateContactValues(values), /ไม่รับข้อตกลง/);
  });
  it('rejects invalid structured fields and calendar dates without making a write', () => {
    for (const data of [
      { version: 2 }, { version: 1, approved: true },
      { version: 1, documentStage: 'approved' },
      { version: 1, answers: { monthlySales: 123 } },
      { version: 1, quality: { businessAge: 'ผ่าน' } },
    ]) {
      const values = contactValues(example());
      values[ix.businessJson] = JSON.stringify({ crmContactV1: data });
      assert.ok(validateContactValues(values));
    }
    const values = contactValues({ ...example(), outcome: 'ขอคุยใหม่', callbackAt: '2026-02-30T10:00' });
    assert.match(validateContactValues(values), /วันเวลา/);
  });
});
