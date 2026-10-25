import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { schemas } from '../../src/schema.ts';
import { CONTACT_SEARCH_HEADER, contactSearchUpdate, isContactSearchChecked, isContactSearchValue } from '../../src/contact-search-status.ts';
import { planContactSearchMigration } from '../../scripts/contact-search-migration.mjs';

const headers = schemas.find(spec => spec.key === 'customers').headers;

describe('manual contact-search result', () => {
  it('treats FALSE and legacy blanks as unmarked, never as a positive finding', () => {
    for (const value of [null, undefined, '', 'FALSE', 'false', false, 'not searched', 0]) {
      assert.equal(isContactSearchChecked(value), false);
    }
    for (const value of ['TRUE', ' true ', true]) assert.equal(isContactSearchChecked(value), true);
    for (const value of ['TRUE', 'FALSE', '', null]) assert.equal(isContactSearchValue(value), true);
    for (const value of ['yes', 'false', 1, true, undefined]) assert.equal(isContactSearchValue(value), false);
  });

  it('updates only the named field and preserves the expected row, even when headers move', () => {
    const reordered = ['ชื่อบริษัท', CONTACT_SEARCH_HEADER, 'รหัสลูกค้า', 'หมายเหตุ'];
    const row = { id: 'SYN-001', values: ['บริษัท ทดสอบ จำกัด', null, 'SYN-001', 'keep this note'] };
    const payload = contactSearchUpdate(reordered, row, true);
    assert.deepEqual(payload.values, ['บริษัท ทดสอบ จำกัด', 'TRUE', 'SYN-001', 'keep this note']);
    assert.deepEqual(payload.expectedValues, row.values);
    assert.equal(row.values[1], null);
    assert.equal(contactSearchUpdate(reordered, { ...row, values: payload.values }, false).values[1], 'FALSE');
    assert.throws(() => contactSearchUpdate(['รหัสลูกค้า'], row, true));
    assert.throws(() => contactSearchUpdate(reordered, { ...row, id: 'SYN-OTHER' }, true));
  });
});

describe('contact-search migration', () => {
  const sheet = { sheetId: 123, gridProperties: { rowCount: 10, columnCount: headers.length - 1 } };

  it('appends one column and native checkbox rules without rewriting records', () => {
    const plan = planContactSearchMigration({ sheet, headers: headers.slice(0, -1), expectedHeaders: headers });
    assert.deepEqual(plan[0], { appendDimension: { sheetId: 123, dimension: 'COLUMNS', length: 1 } });
    const writes = plan.filter(request => request.updateCells);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].updateCells.range.startRowIndex, 0);
    assert.equal(writes[0].updateCells.range.endRowIndex, 1);
    assert.equal(writes[0].updateCells.rows[0].values[0].userEnteredValue.stringValue, CONTACT_SEARCH_HEADER);
    assert.equal(plan.find(request => request.setDataValidation).setDataValidation.rule.condition.type, 'BOOLEAN');
    assert.deepEqual(planContactSearchMigration({ sheet, headers, expectedHeaders: headers }), []);
  });

  it('refuses reordered headers, duplicate fields and occupied target columns', () => {
    assert.throws(() => planContactSearchMigration({ sheet, headers: [...headers].reverse(), expectedHeaders: headers }));
    assert.throws(() => planContactSearchMigration({ sheet, headers: [...headers, CONTACT_SEARCH_HEADER], expectedHeaders: headers }));
    const wide = { ...sheet, gridProperties: { rowCount: 10, columnCount: headers.length } };
    assert.throws(() => planContactSearchMigration({ sheet: wide, headers: headers.slice(0, -1), expectedHeaders: headers }));
    const targetCells = Array.from({ length: 10 }, () => ({}));
    targetCells[3] = { userEnteredValue: { formulaValue: '=1+1' } };
    assert.throws(() => planContactSearchMigration({ sheet: wide, headers: headers.slice(0, -1), expectedHeaders: headers, targetCells }));
  });
});
