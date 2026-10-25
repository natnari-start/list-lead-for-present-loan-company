import assert from 'node:assert/strict';
import { it } from 'node:test';
import { schemas } from '../../src/schema.ts';
import { planContactLogTable } from '../../scripts/contact-log-migration.mjs';

it('updates only contact table width/datetime types, preserves existing properties and is repeatable', () => {
  const spec = schemas.find(item => item.key === 'contacts');
  const table = { tableId: 'synthetic_table', range: { sheetId: 3, startRowIndex: 0, endRowIndex: 501, startColumnIndex: 0, endColumnIndex: 14 }, columnProperties: spec.headers.slice(0, 14).map((columnName, columnIndex) => ({ columnIndex, columnName, columnType: [3, 12].includes(columnIndex) ? 'DATE' : 'TEXT' })) };
  const metadata = { sheets: [{ properties: { title: spec.sheetName }, tables: [table] }] };
  const before = structuredClone(metadata);
  const requests = planContactLogTable(metadata);
  assert.deepEqual(metadata, before);
  assert.equal(requests.length, 1);
  const update = requests[0].updateTable;
  assert.equal(update.fields, 'range,columnProperties');
  assert.equal(update.table.range.endColumnIndex, 15);
  assert.equal(update.table.range.endRowIndex, 501);
  assert.equal(update.table.columnProperties[3].columnType, 'DATE_TIME');
  assert.equal(update.table.columnProperties[12].columnType, 'DATE_TIME');
  assert.deepEqual(update.table.columnProperties[4], table.columnProperties[4]);
  metadata.sheets[0].tables[0] = update.table;
  assert.deepEqual(planContactLogTable(metadata), []);
  metadata.sheets[0].tables[0].columnProperties[4].columnName = 'Unexpected header';
  assert.throws(() => planContactLogTable(metadata), /Unexpected/);
});
