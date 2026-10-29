import type { FinancialAssessment, OverallStatus } from './financial-screening';

type RegistryRow = { id: string; values: unknown[] };

export function filterCustomerRegistryRows(
  rows: RegistryRow[],
  query: string,
  financialFilter: 'all' | OverallStatus,
  assessments: Map<string, FinancialAssessment>
) {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter(row => {
    const matchesQuery = !normalizedQuery || row.values.some(value =>
      String(value ?? '').toLowerCase().includes(normalizedQuery)
    );
    if (!matchesQuery || financialFilter === 'all') return matchesQuery;
    return assessments.get(row.id)?.overall === financialFilter;
  });
}
