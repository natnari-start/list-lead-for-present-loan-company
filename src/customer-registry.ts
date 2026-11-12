import type { FinancialAssessment, OverallStatus } from './financial-screening';
import { schemas } from './schema';

type RegistryRow = { id: string; values: unknown[] };

export type RegistrySortKey = 'year' | 'profit' | 'screening';
export type RegistrySort = { key: RegistrySortKey; direction: 'asc' | 'desc' };
export const registrySortOptions: Array<{ key: RegistrySortKey; label: string }> = [
  { key: 'year', label: 'ปีงบล่าสุด' },
  { key: 'profit', label: 'กำไรสุทธิของงบปีล่าสุด' },
  { key: 'screening', label: 'เกณฑ์ก่อนติดต่อ' },
];
const screeningOrder: Record<OverallStatus, number> = { pass: 0, fail: 1, incomplete: 2 };
const businessTypeCollator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
const customerSpec = schemas.find(spec => spec.key === 'customers')!;
const businessTypeIndex = customerSpec.headers.indexOf('ประเภทธุรกิจ');
const renamedBusinessTypeIndex = customerSpec.headers.indexOf('ชื่อเรียก / ชื่อร้าน');

export function customerBusinessType(row: RegistryRow): string {
  const saved = String(row.values[businessTypeIndex] ?? '').trim();
  const renamed = String(row.values[renamedBusinessTypeIndex] ?? '').trim();
  return saved || (customerSpec.options['5'].some(choice => choice === renamed) ? renamed : '');
}

export function registryBusinessTypeOptions(rows: RegistryRow[]) {
  const counts = new Map<string, number>(customerSpec.options['5'].map(value => [value, 0]));
  counts.set('', 0);
  for (const row of rows) {
    const value = customerBusinessType(row);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].sort(([left], [right]) => {
    if (!left) return 1;
    if (!right) return -1;
    return businessTypeCollator.compare(left, right);
  }).map(([value, count]) => ({ value, label: value || 'ยังไม่ระบุ', count }));
}

export function sortCustomerRegistryRows(
  rows: RegistryRow[],
  sort: RegistrySort | null,
  assessments: Map<string, FinancialAssessment>
): RegistryRow[] {
  if (!sort) return rows;
  const valueOf = (row: RegistryRow): number | null => {
    const assessment = assessments.get(row.id);
    if (sort.key === 'year') return assessment?.latestYear ?? null;
    if (sort.key === 'profit') {
      const latest = assessment?.periods[0];
      return !latest || latest.duplicate ? null : latest.netProfit;
    }
    if (sort.key === 'screening') return assessment ? screeningOrder[assessment.overall] : null;
    return null;
  };
  return rows.map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((left, right) => {
      // Missing values and duplicate-year profits stay last in both directions.
      if (left.value === null && right.value !== null) return 1;
      if (right.value === null && left.value !== null) return -1;
      if (left.value === null || right.value === null) return left.index - right.index;
      const comparison = left.value - right.value;
      return comparison * (sort.direction === 'asc' ? 1 : -1) || left.index - right.index;
    })
    .map(item => item.row);
}

export function prioritizeUncontactedCustomers(
  rows: RegistryRow[],
  contactedCustomerIds: ReadonlySet<string>
): RegistryRow[] {
  if (!contactedCustomerIds.size) return rows;
  const pending: RegistryRow[] = [];
  const contacted: RegistryRow[] = [];
  for (const row of rows) {
    (contactedCustomerIds.has(row.id) ? contacted : pending).push(row);
  }
  return [...pending, ...contacted];
}

export function filterCustomerRegistryRows(
  rows: RegistryRow[],
  query: string,
  financialFilter: 'all' | OverallStatus,
  assessments: Map<string, FinancialAssessment>,
  businessTypes: readonly string[] = []
) {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter(row => {
    if (businessTypes.length && !businessTypes.includes(customerBusinessType(row))) return false;
    const matchesQuery = !normalizedQuery || row.values.some(value =>
      String(value ?? '').toLowerCase().includes(normalizedQuery)
    );
    if (!matchesQuery || financialFilter === 'all') return matchesQuery;
    return assessments.get(row.id)?.overall === financialFilter;
  });
}

