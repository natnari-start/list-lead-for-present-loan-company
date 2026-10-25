export const CONTACT_SEARCH_HEADER = 'ค้นหา Google ไม่พบช่องทางติดต่อ';
export const CONTACT_SEARCH_LABEL = 'seach google ไม่พบข้อมูลช่องทางติดต่อ';

export function isContactSearchChecked(value: unknown): boolean {
  return value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';
}

export function isContactSearchValue(value: unknown): boolean {
  return value === null || value === '' || value === 'TRUE' || value === 'FALSE';
}

export function contactSearchUpdate(
  headers: readonly string[],
  row: { id: string; values: readonly unknown[] },
  checked: boolean
): { values: unknown[]; expectedValues: unknown[] } {
  const index = headers.indexOf(CONTACT_SEARCH_HEADER);
  const idIndex = headers.indexOf('รหัสลูกค้า');
  if (index < 0 || idIndex < 0 || String(row.values[idIndex] ?? '') !== row.id) {
    throw new Error('โครงสร้างข้อมูลลูกค้าไม่ตรง กรุณารีเฟรชก่อนบันทึก');
  }
  const expectedValues = headers.map((_, column) => row.values[column] ?? null);
  const values = [...expectedValues];
  values[index] = checked ? 'TRUE' : 'FALSE';
  return { values, expectedValues };
}
