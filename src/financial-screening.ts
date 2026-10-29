export const financialSchema = {
  key: 'financials',
  sheetName: 'งบการเงินรายปี',
  headers: [
    'รหัสงบการเงิน',
    'รหัสลูกค้า',
    'ปีงบ (ค.ศ.)',
    'รายได้รวม (บาท)',
    'กำไรสุทธิ (บาท)',
    'ดอกเบี้ยจ่าย (บาท)',
    'แหล่งข้อมูล',
    'วันที่ตรวจ',
    'ผู้ตรวจ',
    'หมายเหตุ',
  ],
  required: [0, 1, 2, 3, 4, 5, 6, 7],
  numbers: [2, 3, 4, 5],
  dates: [7],
  options: {},
  optional: true,
} as const;

export type FinancialRow = { id: string; values: unknown[] };
export type CriterionStatus = 'pass' | 'fail' | 'unknown';
export type OverallStatus = 'pass' | 'fail' | 'incomplete';

export type FinancialPeriod = {
  id: string;
  year: number;
  revenue: number | null;
  netProfit: number | null;
  interestExpense: number | null;
  source: string;
  reviewedAt: string;
  reviewer: string;
  note: string;
  duplicate: boolean;
};

export type FinancialAssessment = {
  overall: OverallStatus;
  profitability: CriterionStatus;
  interestBurden: CriterionStatus;
  interestRatio: number | null;
  latestYear: number | null;
  periods: FinancialPeriod[];
  reason: string;
};

export function validateFinancialEntry(
  year: unknown,
  revenue: unknown,
  netProfit: unknown,
  interestExpense: unknown,
  currentYear = new Date().getFullYear()
): string | null {
  const parsedYear = Number(year);
  const parsedRevenue = Number(revenue);
  const parsedProfit = Number(netProfit);
  const parsedInterest = Number(interestExpense);
  if (year === '' || year === null || !Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > currentYear) return 'กรุณากรอกปีงบ ค.ศ. ที่ถูกต้อง';
  if (revenue === '' || revenue === null || !Number.isFinite(parsedRevenue) || parsedRevenue <= 0) return 'รายได้รวมต้องมากกว่า 0';
  if (netProfit === '' || netProfit === null || !Number.isFinite(parsedProfit)) return 'กรุณากรอกกำไรหรือขาดทุนสุทธิ โดยใช้เครื่องหมายลบเมื่อขาดทุน';
  if (interestExpense === '' || interestExpense === null || !Number.isFinite(parsedInterest) || parsedInterest < 0) return 'ดอกเบี้ยจ่ายต้องเป็น 0 หรือมากกว่า';
  return null;
}

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).replace(/[,฿\s]/g, '').replace(/บาท/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export function assessFinancials(rows: FinancialRow[], customerId: string): FinancialAssessment {
  const indexes = Object.fromEntries(financialSchema.headers.map((header, index) => [header, index]));
  const relevant = rows.filter(row => String(row.values[indexes['รหัสลูกค้า']] ?? '') === customerId);
  const byYear = new Map<number, FinancialRow[]>();
  for (const row of relevant) {
    const year = numeric(row.values[indexes['ปีงบ (ค.ศ.)']]);
    if (year === null || !Number.isInteger(year) || year < 1900 || year > 2200) continue;
    byYear.set(year, [...(byYear.get(year) || []), row]);
  }
  const periods = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, entries]) => {
    const row = entries[0];
    return {
      id: row.id,
      year,
      revenue: numeric(row.values[indexes['รายได้รวม (บาท)']]),
      netProfit: numeric(row.values[indexes['กำไรสุทธิ (บาท)']]),
      interestExpense: numeric(row.values[indexes['ดอกเบี้ยจ่าย (บาท)']]),
      source: String(row.values[indexes['แหล่งข้อมูล']] ?? '').trim(),
      reviewedAt: String(row.values[indexes['วันที่ตรวจ']] ?? '').trim(),
      reviewer: String(row.values[indexes['ผู้ตรวจ']] ?? '').trim(),
      note: String(row.values[indexes['หมายเหตุ']] ?? '').trim(),
      duplicate: entries.length > 1,
    };
  });

  const latest = periods[0];
  let profitability: CriterionStatus = 'unknown';
  if (latest) {
    const years = [latest.year, latest.year - 1, latest.year - 2];
    const three = years.map(year => periods.find(period => period.year === year));
    if (three.every((period): period is FinancialPeriod => !!period && !period.duplicate && period.netProfit !== null)) {
      profitability = three.every(period => (period.netProfit as number) < 0) ? 'fail' : 'pass';
    }
  }

  let interestBurden: CriterionStatus = 'unknown';
  let interestRatio: number | null = null;
  if (latest && !latest.duplicate && latest.revenue !== null && latest.revenue > 0 &&
      latest.interestExpense !== null && latest.interestExpense >= 0) {
    interestRatio = latest.interestExpense / latest.revenue;
    interestBurden = interestRatio < 0.05 ? 'pass' : 'fail';
  }

  const overall: OverallStatus = profitability === 'fail' || interestBurden === 'fail'
    ? 'fail'
    : profitability === 'pass' && interestBurden === 'pass'
      ? 'pass'
      : 'incomplete';
  const reason = !latest
    ? 'ยังไม่มีข้อมูลงบการเงินรายปี'
    : latest.duplicate
      ? `พบข้อมูลงบปี ${latest.year} ซ้ำ ต้องตรวจสอบก่อน`
      : profitability === 'unknown'
        ? 'ต้องมีข้อมูลกำไรสุทธิ 3 ปีติดต่อกัน'
        : interestBurden === 'unknown'
          ? 'ต้องมีรายได้รวมและดอกเบี้ยจ่ายของปีล่าสุดเดียวกัน'
          : '';

  return { overall, profitability, interestBurden, interestRatio, latestYear: latest?.year ?? null, periods, reason };
}

export const overallLabel = (status: OverallStatus) => status === 'pass'
  ? 'ผ่านเกณฑ์กรองเบื้องต้น'
  : status === 'fail'
    ? 'ไม่เข้าเกณฑ์กรองเบื้องต้น'
    : 'ข้อมูลไม่พอประเมิน';

export const criterionLabel = (status: CriterionStatus) => status === 'pass'
  ? 'ผ่าน'
  : status === 'fail'
    ? 'ไม่ผ่าน'
    : 'ข้อมูลไม่ครบ';
