import { schemas } from './schema';
import { company, contactPolicy, field, text, type ReadModel } from './crm-read-model';
import { classifyTask, taskWarnings } from './follow-up-view';
type Props = { id: string; model: ReadModel; today: string; datesVerified: boolean; onBack: () => void; onCase: (id: string) => void };
export default function FollowUpTaskDetail({ id, model, today, datesVerified, onBack, onCase }: Props) {
  const row = model.tasks.get(id);
  if (!row) return <section><button type="button" onClick={onBack}>กลับรายการเดิม</button><p role="alert">ไม่พบรายการเดิมหลังรีเฟรช หรือความสัมพันธ์รอตรวจ</p></section>;
  const caseId = text(field(row, 'tasks', 'รหัสเคส (ถ้ามี)'));
  const policy = contactPolicy(model.customers.get(text(field(row, 'tasks', 'รหัสลูกค้า'))));
  return <section aria-label="รายละเอียดงานติดตาม"><button type="button" onClick={onBack}>กลับรายการเดิม</button><h3>งาน {row.id}</h3><p>{company(model, field(row, 'tasks', 'รหัสลูกค้า'))}</p>
    <p className={policy.blocked ? 'cf-alert' : 'cf-note'} role={policy.blocked ? 'alert' : undefined}>{policy.label}</p><p>กลุ่มงาน: {classifyTask(row, today, datesVerified)}</p>
    {taskWarnings(row).map(w => <p key={w} className="cf-note">{w}</p>)}<dl className="cf-grid">{schemas.find(s => s.key === 'tasks')!.headers.map((h, i) => <div key={h}><dt>{i === 9 ? 'ค่าจากสูตรเดิม (ไม่ใช้จัดกลุ่มงาน)' : h}</dt><dd>{text(row.values[i]) || 'ยังไม่ระบุ'}</dd></div>)}</dl>
    <p className="cf-note">ยังไม่มีฟิลด์ผลดำเนินงาน ประเภทงาน หรือวันที่ปรับปรุงแยกใน schema เดิม</p>{caseId ? <button type="button" onClick={() => onCase(caseId)}>ดูเคสที่เกี่ยวข้อง {caseId}</button> : <p>งานระดับลูกค้า ไม่มีเคสเชื่อมโยง</p>}
  </section>;
}

