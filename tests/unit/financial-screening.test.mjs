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
  it('passes when the latest three years are not all losses and interest is below 5%', () => {
    const result = assessFinancials([row(2025, 100, 1, 4.99), row(2024, 90, -1, 2), row(2023, 80, -2, 2)], 'CUST-1');
    assert.equal(result.profitability, 'pass');
    assert.equal(result.interestBurden, 'pass');
    assert.equal(result.overall, 'pass');
  });

  it('fails three consecutive losses and treats exactly 5% as not passing', () => {
    const result = assessFinancials([row(2025, 100, -1, 5), row(2024, 90, -1, 2), row(2023, 80, -1, 2)], 'CUST-1');
    assert.equal(result.profitability, 'fail');
    assert.equal(result.interestBurden, 'fail');
    assert.equal(result.overall, 'fail');
  });

  it('does not treat missing, invalid, non-consecutive or duplicate data as passing', () => {
    assert.equal(assessFinancials([row(2025, 0, 0, 0), row(2023, 80, 0, 2)], 'CUST-1').overall, 'incomplete');
    assert.equal(assessFinancials([row(2025, 100, 1, 1), row(2025, 100, 1, 1, 'DUP'), row(2024, 90, 1, 1), row(2023, 80, 1, 1)], 'CUST-1').overall, 'incomplete');
  });

  it('keeps zero profit distinct from a loss', () => {
    const result = assessFinancials([row(2025, 100, 0, 0), row(2024, 90, -1, 1), row(2023, 80, -1, 1)], 'CUST-1');
    assert.equal(result.profitability, 'pass');
  });
});
