import { CONTACT_SEARCH_HEADER } from '../src/contact-search-status.ts';

// Pure planner: no credentials, network, customer values or implicit writes.
export function planContactSearchMigration({ sheet, headers, expectedHeaders, targetCells = [] }) {
  const { sheetId, gridProperties } = sheet;
  const target = expectedHeaders.indexOf(CONTACT_SEARCH_HEADER);
  if (target < 1 || target !== expectedHeaders.length - 1 ||
      !Number.isInteger(sheetId) || !gridProperties?.rowCount || !gridProperties?.columnCount) {
    throw new Error('Invalid migration schema or sheet metadata');
  }
  const actual = [...headers];
  while (actual.length && (actual.at(-1) === '' || actual.at(-1) == null)) actual.pop();
  if (actual.length === expectedHeaders.length && actual.every((value, index) => value === expectedHeaders[index])) {
    return [];
  }
  if (actual.length !== target || actual.some((value, index) => value !== expectedHeaders[index])) {
    throw new Error('Existing headers differ; migration refused without changing the sheet');
  }
  if (gridProperties.columnCount > target && targetCells.length !== gridProperties.rowCount) {
    throw new Error('Inspect the entire existing target column before migration');
  }
  if (targetCells.some(cell => cell?.userEnteredValue || cell?.chipRuns?.length || cell?.dataValidation || cell?.note)) {
    throw new Error('Target column is occupied; migration refused');
  }
  const range = { sheetId, startColumnIndex: target, endColumnIndex: target + 1 };
  const requests = [];
  if (gridProperties.columnCount <= target) {
    requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: target + 1 - gridProperties.columnCount } });
  }
  requests.push(
    { copyPaste: {
      source: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: target - 1, endColumnIndex: target },
      destination: { ...range, startRowIndex: 0, endRowIndex: 1 },
      pasteType: 'PASTE_FORMAT',
    } },
    { updateCells: {
      range: { ...range, startRowIndex: 0, endRowIndex: 1 },
      rows: [{ values: [{ userEnteredValue: { stringValue: CONTACT_SEARCH_HEADER } }] }],
      fields: 'userEnteredValue',
    } },
    { setDataValidation: {
      range: { ...range, startRowIndex: 1, endRowIndex: gridProperties.rowCount },
      rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
    } },
    { updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: target, endIndex: target + 1 },
      properties: { pixelSize: 260 },
      fields: 'pixelSize',
    } }
  );
  return requests;
}
