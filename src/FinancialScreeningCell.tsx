import { assessFinancials, criterionLabel, overallLabel, type FinancialRow } from './financial-screening';

type Props = { customerId: string; rows: FinancialRow[] };

const amount = (value: number | null) => value === null
  ? '—'
  : new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value);

const mark = (status: 'pass' | 'fail' | 'unknown') => status === 'pass' ? '✓' : status === 'fail' ? '✕' : '?';

export function LatestFinancialCell({ customerId, rows }: Props) {
  const latest = assessFinancials(rows, customerId).periods[0];
  if (!latest) return <span className="muted-financial">ยังไม่มีข้อมูลงบ</span>;
  const profitClass = latest.netProfit === null ? 'unknown' : latest.netProfit < 0 ? 'negative' : 'positive';
  return <div className="latest-financial registry-latest-financial">
    <strong>ปี {latest.year}{latest.duplicate ? ' · พบรายการซ้ำ' : ''}</strong>
    <span className={`registry-net-profit ${profitClass}`}>กำไร (ขาดทุน) สุทธิ: {amount(latest.netProfit)} บาท</span>
  </div>;
}

export function RegistryScreeningCell({ customerId, rows }: Props) {
  const result = assessFinancials(rows, customerId);
  const summary = result.overall === 'pass' ? 'ผ่านเกณฑ์' : result.overall === 'fail' ? 'ไม่ผ่านเกณฑ์' : 'ข้อมูลไม่พอ';
  const ratio = result.interestRatio === null
    ? 'ข้อมูลรายได้หรือดอกเบี้ยไม่ครบ'
    : `ดอกเบี้ยต่อรายได้ ${(result.interestRatio * 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}%`;
  return <div className="registry-screening" aria-label={`เกณฑ์ก่อนติดต่อ: ${summary}`}>
    <span className={`screening-summary ${result.overall}`}>{summary}</span>
    <small><b aria-hidden="true">{mark(result.profitability)}</b> ผลประกอบการ: {criterionLabel(result.profitability)} · {result.profitabilityReason}</small>
    <small><b aria-hidden="true">{mark(result.interestBurden)}</b> ภาระดอกเบี้ย: {criterionLabel(result.interestBurden)} · {ratio}</small>
  </div>;
}

export function FinancialHistory({ customerId, rows }: Props) {
  const periods = assessFinancials(rows, customerId).periods;
  if (!periods.length) return <p className="muted-financial">ยังไม่มีข้อมูลงบการเงิน</p>;
  return <div className="profile-financial-history">
    {periods.slice(0, 3).map(period => <article key={`${period.year}-${period.id}`}>
      <strong>ปี {period.year}{period.duplicate ? ' · พบรายการซ้ำ' : ''}</strong>
      <span>กำไร (ขาดทุน) สุทธิ: {amount(period.netProfit)} บาท</span>
      <span>รายได้รวม: {amount(period.revenue)} บาท</span>
      <span>ดอกเบี้ยจ่าย: {amount(period.interestExpense)} บาท</span>
    </article>)}
  </div>;
}

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
      <small>{criterionLabel(result.profitability)} · {result.profitabilityReason}</small>
    </div>
    <div className={`screening-criterion ${result.interestBurden}`}>
      <b aria-hidden="true">{mark(result.interestBurden)}</b>
      <span>ภาระดอกเบี้ย</span>
      <small>{criterionLabel(result.interestBurden)}{ratio} · เกณฑ์ต่ำกว่า 5%</small>
    </div>
    {result.reason && <small className="screening-reason">{result.reason}</small>}
  </div>;
}
