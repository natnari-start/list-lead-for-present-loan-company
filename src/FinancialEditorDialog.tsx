import { useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import { assessFinancials, financialSchema, overallLabel, validateFinancialEntry, type FinancialRow } from './financial-screening';

type CustomerRow = { id: string; values: unknown[] };
type Props = {
  customer: CustomerRow;
  companyName: string;
  rows: FinancialRow[];
  disabled?: boolean;
  onClose: () => void;
  onSaved: (row: FinancialRow, replayed: boolean) => void;
};

const indexes = Object.fromEntries(financialSchema.headers.map((header, index) => [header, index]));
const yearOf = (row: FinancialRow) => Number(row.values[indexes['ปีงบ (ค.ศ.)']]);
const text = (value: unknown) => value === null || value === undefined ? '' : String(value);
const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export default function FinancialEditorDialog({ customer, companyName, rows, disabled, onClose, onSaved }: Props) {
  const customerRows = useMemo(() => rows
    .filter(row => String(row.values[indexes['รหัสลูกค้า']] ?? '') === customer.id)
    .sort((a, b) => yearOf(b) - yearOf(a)), [customer.id, rows]);
  const initialYear = customerRows[0] ? yearOf(customerRows[0]) : new Date().getFullYear() - 1;
  const [year, setYear] = useState(String(initialYear));
  const [revenue, setRevenue] = useState(() => text(customerRows[0]?.values[indexes['รายได้รวม (บาท)']]));
  const [netProfit, setNetProfit] = useState(() => text(customerRows[0]?.values[indexes['กำไรสุทธิ (บาท)']]));
  const [interestExpense, setInterestExpense] = useState(() => text(customerRows[0]?.values[indexes['ดอกเบี้ยจ่าย (บาท)']]));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const matches = customerRows.filter(row => yearOf(row) === Number(year));
  const existing = matches.length === 1 ? matches[0] : null;
  const duplicate = matches.length > 1;
  const draftValues = financialSchema.headers.map(() => null) as unknown[];
  draftValues[indexes['รหัสงบการเงิน']] = existing?.id ?? 'DRAFT';
  draftValues[indexes['รหัสลูกค้า']] = customer.id;
  draftValues[indexes['ปีงบ (ค.ศ.)']] = year === '' ? null : Number(year);
  draftValues[indexes['รายได้รวม (บาท)']] = revenue === '' ? null : Number(revenue);
  draftValues[indexes['กำไรสุทธิ (บาท)']] = netProfit === '' ? null : Number(netProfit);
  draftValues[indexes['ดอกเบี้ยจ่าย (บาท)']] = interestExpense === '' ? null : Number(interestExpense);
  draftValues[indexes['แหล่งข้อมูล']] = existing?.values[indexes['แหล่งข้อมูล']] || 'กรอกใน WebApp';
  draftValues[indexes['วันที่ตรวจ']] = today();
  const previewRows = [...rows.filter(row => row.id !== existing?.id), { id: String(draftValues[0]), values: draftValues }];
  const preview = assessFinancials(previewRows, customer.id);

  const selectYear = (nextYear: string) => {
    setYear(nextYear);
    const found = customerRows.find(row => yearOf(row) === Number(nextYear));
    setRevenue(text(found?.values[indexes['รายได้รวม (บาท)']]));
    setNetProfit(text(found?.values[indexes['กำไรสุทธิ (บาท)']]));
    setInterestExpense(text(found?.values[indexes['ดอกเบี้ยจ่าย (บาท)']]));
    setError('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedYear = Number(year);
    const invalid = validateFinancialEntry(year, revenue, netProfit, interestExpense);
    if (invalid) return setError(invalid);
    if (duplicate) return setError('พบงบปีนี้มากกว่า 1 รายการ กรุณาตรวจสอบรายการซ้ำใน Google Sheets ก่อน');
    setSaving(true);
    setError('');
    try {
      let saved: FinancialRow;
      let replayed = false;
      if (existing) {
        const values = [...existing.values];
        values[indexes['ปีงบ (ค.ศ.)']] = parsedYear;
        values[indexes['รายได้รวม (บาท)']] = Number(revenue);
        values[indexes['กำไรสุทธิ (บาท)']] = Number(netProfit);
        values[indexes['ดอกเบี้ยจ่าย (บาท)']] = Number(interestExpense);
        const response = await api.put(`/api/records/financials/${encodeURIComponent(existing.id)}`, {
          expectedValues: existing.values, values,
        });
        saved = (response.data.data.financials as FinancialRow[]).find(row => row.id === existing.id)!;
      } else {
        draftValues[0] = null;
        const response = await api.post('/api/records', {
          part: 'financials', requestId: crypto.randomUUID(), values: draftValues,
        });
        saved = response.data.record as FinancialRow;
        replayed = !!response.data.replayed;
      }
      onSaved(saved, replayed);
    } catch (cause) {
      const message = (cause as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message || (cause instanceof Error ? cause.message : 'บันทึกงบการเงินไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && onClose()}>
    <form className="modal financial-editor" onSubmit={save}>
      <div className="modal-head">
        <div><p className="eyebrow">FINANCIAL DATA</p><h2>เพิ่มข้อมูลงบการเงิน</h2><p className="small-note">{companyName}</p></div>
        <button className="button" type="button" onClick={onClose}>ปิด</button>
      </div>
      <p className="small-note">กรอกปีล่าสุดก่อน หากปีล่าสุดขาดทุนให้กรอกปีก่อนหน้าต่อเนื่อง สูงสุด 3 ปี ระบบจะคำนวณเกณฑ์ให้อัตโนมัติ</p>
      {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')}>ปิด</button></div>}
      <div className="financial-year-picker">
        <label><span>เลือกปีที่มีข้อมูลแล้ว</span><select value={existing ? year : ''} onChange={event => event.target.value && selectYear(event.target.value)}>
          <option value="">— เพิ่มปีใหม่ —</option>
          {[...new Set(customerRows.map(yearOf))].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <button className="button" type="button" onClick={() => selectYear(String(new Date().getFullYear() - 1))}>เพิ่มปีใหม่</button>
      </div>
      <div className="form-grid financial-form-grid">
        <label><span>ปีงบ (ค.ศ.) *</span><input type="number" min="1900" max={new Date().getFullYear()} value={year} onChange={event => selectYear(event.target.value)} /></label>
        <label><span>รายได้รวม (บาท) *</span><input type="number" min="0.01" step="0.01" value={revenue} onChange={event => setRevenue(event.target.value)} /></label>
        <label><span>กำไร (ขาดทุน) สุทธิ (บาท) *</span><input type="number" step="0.01" value={netProfit} placeholder="ขาดทุนให้ใส่เครื่องหมายลบ" onChange={event => setNetProfit(event.target.value)} /></label>
        <label><span>ดอกเบี้ยจ่าย (บาท) *</span><input type="number" min="0" step="0.01" value={interestExpense} onChange={event => setInterestExpense(event.target.value)} /></label>
      </div>
      <div className={`financial-preview ${preview.overall}`}>
        <strong>ผลคำนวณตัวอย่าง: {overallLabel(preview.overall)}</strong>
        <span>อัตราดอกเบี้ยต่อรายได้: {preview.interestRatio === null ? 'ข้อมูลไม่ครบ' : `${(preview.interestRatio * 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}%`}</span>
        <small>ภาระดอกเบี้ยต้องต่ำกว่า 5% และผลประกอบการต้องไม่ขาดทุนต่อเนื่องครบ 3 ปี</small>
      </div>
      <div className="modal-foot">
        <button className="button" type="button" onClick={onClose}>ยกเลิก</button>
        <button className="button primary" type="submit" disabled={disabled || saving || duplicate}>{saving ? 'กำลังบันทึก…' : existing ? 'บันทึกการแก้ไข' : 'เพิ่มข้อมูลงบ'}</button>
      </div>
    </form>
  </div>;
}
