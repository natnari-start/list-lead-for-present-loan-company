import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterCustomerRegistryRows } from '../../src/customer-registry.ts';

const rows = [
  { id: 'PASS', values: ['PASS', 'บริษัท ผ่านเกณฑ์ จำกัด'] },
  { id: 'FAIL', values: ['FAIL', 'บริษัท ไม่ผ่านเกณฑ์ จำกัด'] },
  { id: 'INCOMPLETE', values: ['INCOMPLETE', 'บริษัท ข้อมูลไม่พอ จำกัด'] },
];
const assessments = new Map([
  ['PASS', { overall: 'pass' }],
  ['FAIL', { overall: 'fail' }],
  ['INCOMPLETE', { overall: 'incomplete' }],
]);

describe('customer registry search and status filter', () => {
  it('uses the same displayed rows for search, status filters and summary counts', () => {
    const searched = filterCustomerRegistryRows(rows, 'ข้อมูลไม่พอ', 'all', assessments);
    const failed = filterCustomerRegistryRows(rows, '', 'fail', assessments);
    const combined = filterCustomerRegistryRows(rows, 'บริษัท', 'pass', assessments);
    assert.deepEqual(searched.map(row => row.id), ['INCOMPLETE']);
    assert.deepEqual(failed.map(row => row.id), ['FAIL']);
    assert.deepEqual(combined.map(row => row.id), ['PASS']);
    assert.deepEqual(
      searched.reduce((summary, row) => {
        summary.total += 1;
        summary[assessments.get(row.id).overall] += 1;
        return summary;
      }, { total: 0, pass: 0, fail: 0, incomplete: 0 }),
      { total: 1, pass: 0, fail: 0, incomplete: 1 }
    );
  });
});
