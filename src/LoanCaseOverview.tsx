import { caseSummary } from './loan-case-view';
import { field, text, presentMoney, type ReadModel } from './crm-read-model';
type Props = { model: ReadModel; query: string; status: string; owner: string; pending: string; dnc: boolean; onOpen: (id: string) => void; onTasks: (id: string) => void };
export default function LoanCaseOverview({ model, query, status, owner, pending, dnc, onOpen, onTasks }: Props) {
  const rows = [...model.cases.values()].filter(row => {
    const s = caseSummary(model, row);
    return (!query.trim() || [row.id, s.customerId, s.companyName, text(field(row, 'cases', 'ผู้รับช่วงงาน'))].some(v => v.toLowerCase().includes(query.trim().toLowerCase())))
      && (!status || field(row, 'cases', 'สถานะเคส') === status)
      && (!owner || field(row, 'cases', 'ผู้รับช่วงงาน') === owner)
      && (!pending || (pending === 'yes' ? s.openCount > 0 : s.openCount === 0)) && (!dnc || s.policy.blocked);
  }).sort((a, b) => a.id.localeCompare(b.id));
  return <section aria-label="ภาพรวมเคสสินเชื่อ"><p aria-live="polite">แสดง {rows.length} เคสจากรายการที่เชื่อมโยงถูกต้อง {model.cases.size} เคส</p>
    <div className="cf-list">{rows.map(row => { const s = caseSummary(model, row); return <article className="cf-card" key={row.id}>
      <header><h3><button type="button" className="cf-link" aria-label={`ดูบริษัทของเคส ${row.id}`} onClick={() => onOpen(row.id)}>{s.companyName}</button></h3><span className="cf-badge">{text(field(row, 'cases', 'สถานะเคส')) || 'สถานะรอตรวจ'}</span></header>
      <p>เคส {row.id} · ลูกค้า {s.customerId}</p><p className={s.policy.blocked ? 'cf-alert' : 'cf-note'}>{s.policy.label}</p>
      <dl className="cf-grid"><div><dt>ผลิตภัณฑ์</dt><dd>{text(field(row, 'cases', 'ผลิตภัณฑ์')) || 'ยังไม่ระบุ'}</dd></div><div><dt>วงเงินที่ขอ</dt><dd>{presentMoney(field(row, 'cases', 'วงเงินที่ขอ (บาท)'))}</dd></div><div><dt>ผู้รับช่วงงาน</dt><dd>{text(field(row, 'cases', 'ผู้รับช่วงงาน')) || 'ยังไม่ระบุ'}</dd></div><div><dt>วันที่ตรวจสถานะล่าสุด</dt><dd>{text(field(row, 'cases', 'วันที่ตรวจสถานะล่าสุด')) || 'ยังไม่ระบุ'} (ค่าที่บันทึกไว้)</dd></div></dl>
      <p>งานค้าง {s.openCount} งาน · เอกสารเดิม {s.documents.legacyCounts.total} รายการ — ยังไม่จัดประเภท Checklist</p>
      <div className="cf-actions"><button type="button" onClick={() => onOpen(row.id)}>ดูรายละเอียดเคส {row.id}</button><button type="button" onClick={() => onTasks(row.id)}>ดูงานของเคส {row.id}</button></div>
    </article>; })}</div>{!rows.length && <p className="cf-empty">ไม่พบเคสที่ตรงกับตัวกรองจากข้อมูลที่โหลดสำเร็จ</p>}</section>;
}

