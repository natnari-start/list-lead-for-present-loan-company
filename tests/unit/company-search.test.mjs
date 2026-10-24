import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCompanySearchLink } from '../../src/company-search.ts';

describe('company Google Search link', () => {
  it('uses the company-name header and trims a Thai draft name', () => {
    const headers = ['ชื่อบริษัท', 'รหัสลูกค้า'];
    const link = getCompanySearchLink(headers, [
      '  บริษัท ทดสอบ เอสเอ็มอี จำกัด  ',
      'SYN-CUST-001',
    ]);

    assert.equal(link.name, 'บริษัท ทดสอบ เอสเอ็มอี จำกัด');
    const url = new URL(link.href);
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('q'), link.name);
    assert.equal(url.searchParams.size, 1);
  });

  it('keeps special characters in the query rather than adding URL parameters', () => {
    const name = 'บริษัท ทดสอบ A&B #1? จำกัด / 100%';
    const link = getCompanySearchLink(['ชื่อบริษัท'], [name]);
    const url = new URL(link.href);

    assert.equal(url.searchParams.get('q'), name);
    assert.equal(url.searchParams.size, 1);
    assert.equal(url.hash, '');
    assert.ok(link.href.includes('%26'));
    assert.ok(link.href.includes('%23'));
    assert.ok(link.href.includes('%25'));
  });

  it('reflects the current draft without changing the form values', () => {
    const headers = ['รหัสลูกค้า', 'ชื่อบริษัท'];
    const original = ['SYN-CUST-001', 'บริษัท ทดสอบ เดิม จำกัด'];
    const draft = [...original];
    draft[1] = 'บริษัท ทดสอบ ใหม่ จำกัด';

    const link = getCompanySearchLink(headers, draft);
    assert.equal(new URL(link.href).searchParams.get('q'), draft[1]);
    assert.equal(original[1], 'บริษัท ทดสอบ เดิม จำกัด');
    assert.deepEqual(draft, ['SYN-CUST-001', 'บริษัท ทดสอบ ใหม่ จำกัด']);
  });

  it('does not create a link for blank or missing company data', () => {
    for (const name of ['', '  \t\n  ', null, undefined]) {
      assert.equal(getCompanySearchLink(['ชื่อบริษัท'], [name]), null);
    }
    assert.equal(getCompanySearchLink(['ชื่อบริษัท'], []), null);
    assert.equal(getCompanySearchLink(['รหัสลูกค้า'], ['SYN-CUST-001']), null);
  });
});
