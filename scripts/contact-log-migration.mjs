import { contactIndexes, contactSpec } from '../src/contact-log.ts';

// Pure native-table metadata planner. No credentials, file IDs or row writes.
export function planContactLogTable(metadata) {
  const sheet = metadata.sheets?.find(item => item.properties?.title === 'ประวัติการติดต่อ');
  if (!sheet) throw new Error('Contact history sheet is missing');
  const tables = (sheet.tables || []).filter(item => (item.range?.startColumnIndex || 0) === 0);
  if (tables.length > 1) throw new Error('Ambiguous contact table');
  if (!tables.length) return [];
  const table = tables[0];
  const width = contactSpec.headers.length;
  if (![width - 1, width].includes(table.range?.endColumnIndex) || table.range?.startRowIndex !== 0) throw new Error('Unexpected table range; manual review required');
  const properties = structuredClone(table.columnProperties || []);
  if (properties.some((column, index) => (column.columnIndex || 0) !== index || column.columnName !== contactSpec.headers[index])) throw new Error('Unexpected table columns; manual review required');
  if (properties.length !== table.range.endColumnIndex) throw new Error('Incomplete table metadata');
  const indexes = contactIndexes();
  let changed = table.range.endColumnIndex !== width;
  for (const index of [indexes.contactedAt, indexes.verifiedAt]) {
    if (properties[index].columnType !== 'DATE_TIME') { properties[index].columnType = 'DATE_TIME'; changed = true; }
  }
  if (properties.length < width) properties.push({ columnIndex: width - 1, columnName: contactSpec.headers[width - 1], columnType: 'TEXT' });
  return changed ? [{ updateTable: { table: { tableId: table.tableId, range: { ...table.range, endColumnIndex: width }, columnProperties: properties }, fields: 'range,columnProperties' } }] : [];
}
