import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessFinancials, financialSchema, validateFinancialEntry } from '../../src/financial-screening.ts';

const i = Object.fromEntries(financialSchema.headers.map((header, index) => [header, index]));
const row = (year, revenue, profit, interest, id = `FIN-${year}`) => {
  const values = financialSchema.headers.map(() => null);
  values[i['รหัสงบการเงิน']] = id;
  values[i['รหัสลูกค้า']] = 'CUST-1';
  values[i['ปีงบ (ค.ศ.)']] = year;
  values[i['รายได้รวม (บาท)']] = revenue;
  values[i['กำไรสุทธิ (บาท)']] = profit;
  values[i['ดอกเบี้ยจ่าย (บาท)']] = interest;
  values[i['แหล่งข้อมูล']] = 'งบการเงินที่ตรวจแล้ว';
  return { id, values };
};

describe('financial screening before contact', () => {
  it('validates manual financial input without rejecting a legitimate loss', () => {
    assert.equal(validateFinancialEntry(2025, 1000000, -250000, 25000, 2026), null);
    assert.match(validateFinancialEntry(2027, 1000000, 1, 1, 2026), /ปีงบ/);
    assert.match(validateFinancialEntry(2025, 0, 1, 1, 2026), /รายได้รวม/);
    assert.match(validateFinancialEntry(2025, 1000000, 1, -1, 2026), /ดอกเบี้ยจ่าย/);
  });
  it('passes immediately when the latest year is profitable or zero', () => {
    const profitable = assessFinancials([row(2025, 100, 1, 4.99)], 'CUST-1');
    const zero = assessFinancials([row(2025, 100, 0, 4.99)], 'CUST-1');
    assert.equal(profitable.profitability, 'pass');
    assert.equal(profitable.profitabilityReason, 'ปีล่าสุดมีกำไรหรือไม่ขาดทุน');
    assert.equal(profitable.overall, 'pass');
    assert.equal(zero.profitability, 'pass');
    assert.equal(zero.overall, 'pass');
  });

  it('passes when the previous year breaks the loss sequence', () => {
    const result = assessFinancials([row(2025, 100, -1, 4.99), row(2024, 90, 1, 2)], 'CUST-1');
    assert.equal(result.profitability, 'pass');
    assert.equal(result.profitabilityReason, 'ไม่ขาดทุนต่อเนื่องครบ 3 ปี');
    assert.equal(result.interestBurden, 'pass');
    assert.equal(result.overall, 'pass');
  });

  it('passes when the third year breaks the loss sequence', () => {
    const result = assessFinancials([row(2025, 100, -1, 4), row(2024, 90, -1, 2), row(2023, 80, 1, 2)], 'CUST-1');
    assert.equal(result.profitability, 'pass');
    assert.equal(result.profitabilityReason, 'ไม่ขาดทุนต่อเนื่องครบ 3 ปี');
    assert.equal(result.overall, 'pass');
  });

  it('fails only after three consecutive losses', () => {
    const result = assessFinancials([row(2025, 100, -1, 4), row(2024, 90, -1, 2), row(2023, 80, -1, 2)], 'CUST-1');
    assert.equal(result.profitability, 'fail');
    assert.equal(result.profitabilityReason, 'ขาดทุนต่อเนื่อง 3 ปี');
    assert.equal(result.overall, 'fail');
  });

  it('requests the previous year after one loss', () => {
    const result = assessFinancials([row(2025, 100, -1, 4)], 'CUST-1');
    assert.equal(result.profitability, 'unknown');
    assert.equal(result.overall, 'incomplete');
    assert.match(result.reason, /ปี 2024/);
    assert.match(result.reason, /ปีล่าสุดขาดทุน/);
  });

  it('requests the third year after two losses', () => {
    const result = assessFinancials([row(2025, 100, -1, 4), row(2024, 90, -1, 2)], 'CUST-1');
    assert.equal(result.profitability, 'unknown');
    assert.equal(result.overall, 'incomplete');
    assert.match(result.reason, /ปี 2023/);
    assert.match(result.reason, /ขาดทุนต่อเนื่อง 2 ปี/);
  });

  it('does not pass non-consecutive, duplicate or invalid profit data', () => {
    const gap = assessFinancials([row(2025, 100, -1, 4), row(2023, 80, 1, 2)], 'CUST-1');
    const duplicate = assessFinancials([row(2025, 100, -1, 4), row(2024, 90, 1, 2), row(2024, 90, 1, 2, 'DUP')], 'CUST-1');
    const invalid = assessFinancials([row(2025, 100, 'not-a-number', 4)], 'CUST-1');
    assert.equal(gap.profitability, 'unknown');
    assert.match(gap.reason, /ปี 2024/);
    assert.equal(duplicate.profitability, 'unknown');
    assert.match(duplicate.reason, /ปี 2024.*ซ้ำ/);
    assert.equal(invalid.profitability, 'unknown');
    assert.match(invalid.reason, /กำไรสุทธิปี 2025.*ไม่ถูกต้อง/);
  });

  it('keeps the existing interest burden thresholds unchanged', () => {
    const below = assessFinancials([row(2025, 100, 1, 4.99)], 'CUST-1');
    const equal = assessFinancials([row(2025, 100, 1, 5)], 'CUST-1');
    const above = assessFinancials([row(2025, 100, 1, 5.01)], 'CUST-1');
    const zeroRevenue = assessFinancials([row(2025, 0, 1, 0)], 'CUST-1');
    const missingRevenue = assessFinancials([row(2025, null, 1, 1)], 'CUST-1');
    const missingInterest = assessFinancials([row(2025, 100, 1, null)], 'CUST-1');
    assert.equal(below.interestBurden, 'pass');
    assert.equal(equal.interestBurden, 'fail');
    assert.equal(above.interestBurden, 'fail');
    assert.equal(zeroRevenue.interestBurden, 'unknown');
    assert.equal(missingRevenue.interestBurden, 'unknown');
    assert.equal(missingInterest.interestBurden, 'unknown');
  });
});
