import { assessFinancials, criterionLabel, overallLabel, type FinancialRow } from './financial-screening';

type Props = { customerId: string; rows: FinancialRow[] };

const amount = (value: number | null) => value === null
  ? '—'
  : new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value);

const mark = (status: 'pass' | 'fail' | 'unknown') => status === 'pass' ? '✓' : status === 'fail' ? '✕' : '?';

export default function FinancialScreeningCell({ customerId, rows }: Props) {
  const result = assessFinancials(rows, customerId);
  const ratio = result.interestRatio === null
    ? ''
    : ` · ${(result.interestRatio * 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}%`;
  return <div className="financial-screening">
    <span className={`screening-summary ${result.overall}`}>{overallLabel(result.overall)}</span>
    <div className={`screening-criterion ${result.profitability}`}>
      <b aria-hidden="true">{mark(result.profitability)}</b>
      <span>ผลประกอบการ</span>
      <small>{criterionLabel(result.profitability)} · ไม่ขาดทุนต่อเนื่อง 3 ปี</small>
    </div>
    <div className={`screening-criterion ${result.interestBurden}`}>
      <b aria-hidden="true">{mark(result.interestBurden)}</b>
      <span>ภาระดอกเบี้ย</span>
      <small>{criterionLabel(result.interestBurden)}{ratio} · เกณฑ์ต่ำกว่า 5%</small>
    </div>
    {result.reason && <small className="screening-reason">{result.reason}</small>}
    {!!result.periods.length && <details className="screening-details">
      <summary>ดูรายละเอียดงบ</summary>
      <div className="screening-periods">
        {result.periods.slice(0, 3).map(period => <div key={`${period.year}-${period.id}`}>
          <strong>ปี {period.year}{period.duplicate ? ' · พบรายการซ้ำ' : ''}</strong>
          <span>รายได้ {amount(period.revenue)} บาท</span>
          <span>กำไรสุทธิ {amount(period.netProfit)} บาท</span>
          <span>ดอกเบี้ยจ่าย {amount(period.interestExpense)} บาท</span>
          <small>{period.source ? `แหล่ง: ${period.source}` : 'ยังไม่ระบุแหล่งข้อมูล'}{period.reviewedAt ? ` · ตรวจ ${period.reviewedAt}` : ''}</small>
        </div>)}
      </div>
    </details>}
  </div>;
}
