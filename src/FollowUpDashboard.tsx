import { company, contactPolicy, field, text, type ReadModel } from './crm-read-model';
import { classifyTask, taskWarnings, isOpenTask } from './follow-up-view';
export const taskGroups = ['วันนี้', 'เกินกำหนด', 'รอยืนยันวัน', 'กำลังดำเนินการ', 'เสร็จแล้ว', 'ยกเลิก', 'ยังไม่กำหนดวัน', 'รอถึงกำหนด', 'วันรอตรวจ', 'ประเภทวันรอตรวจ', 'สถานะรอตรวจ'];
type Props = { model: ReadModel; today: string; datesVerified: boolean; query: string; status: string; owner: string; kind: string; group: string; caseId: string; dnc: boolean; onGroup: (group: string) => void; onOpen: (id: string) => void };
export default function FollowUpDashboard({ model, today, datesVerified, query, status, owner, kind, group, caseId, dnc, onGroup, onOpen }: Props) {
  const base = [...model.tasks.values()].filter(row => {
    const cid = field(row, 'tasks', 'รหัสลูกค้า');
    return (!query.trim() || [row.id, cid, field(row, 'tasks', 'รหัสเคส (ถ้ามี)'), field(row, 'tasks', 'งานที่ต้องทำ'), field(row, 'tasks', 'ผู้รับผิดชอบ'), company(model, cid)].some(v => text(v).toLowerCase().includes(query.trim().toLowerCase())))
      && (!status || field(row, 'tasks', 'สถานะงาน') === status) && (!owner || field(row, 'tasks', 'ผู้รับผิดชอบ') === owner)
      && (!kind || field(row, 'tasks', 'ประเภทวันกำหนด') === kind) && (!caseId || field(row, 'tasks', 'รหัสเคส (ถ้ามี)') === caseId)
      && (!dnc || contactPolicy(model.customers.get(text(cid))).blocked);
  });
  const match = (row: typeof base[number], selected: string) => selected === 'กำลังดำเนินการ' ? field(row, 'tasks', 'สถานะงาน') === selected : classifyTask(row, today, datesVerified) === selected;
  const rows = base.filter(row => !group || match(row, group)).sort((a, b) => {
    const rank = (row: typeof a) => { const g = classifyTask(row, today, datesVerified); return g === 'วันนี้' ? 0 : g === 'เกินกำหนด' ? 1 : isOpenTask(row) ? 2 : 3; };
    return rank(a) - rank(b) || (datesVerified ? text(field(a, 'tasks', 'วันครบกำหนด')).localeCompare(text(field(b, 'tasks', 'วันครบกำหนด'))) : 0) || a.id.localeCompare(b.id);
  });
  return <section aria-label="แดชบอร์ดงานติดตาม"><div className="cf-stats">{taskGroups.map(g => <button type="button" key={g} aria-pressed={group === g} onClick={() => onGroup(group === g ? '' : g)}><span>{g}</span><strong>{base.filter(r => match(r, g)).length}</strong></button>)}</div>
    <p className="cf-note">การ์ดสถานะและกำหนดเวลาอาจทับซ้อนกัน ไม่นำยอดการ์ดมาบวกกัน · ไม่มีการสร้างวันนัดหรือสิทธิ์ติดต่อ</p>
    {group && <button type="button" onClick={() => onGroup('')}>ล้างกลุ่ม {group}</button>}<p aria-live="polite">แสดง {rows.length} งานจาก {base.length} งานตามตัวกรอง</p>
    <div className="cf-list">{rows.map(row => { const policy = contactPolicy(model.customers.get(text(field(row, 'tasks', 'รหัสลูกค้า')))); return <article className="cf-card" key={row.id}><header><h3><button type="button" className="cf-link" onClick={() => onOpen(row.id)}>{text(field(row, 'tasks', 'งานที่ต้องทำ')) || 'ยังไม่ระบุชื่องาน'}</button></h3><span className="cf-badge">{classifyTask(row, today, datesVerified)}</span></header>
      <p>{row.id} · {company(model, field(row, 'tasks', 'รหัสลูกค้า'))}</p><p>ลูกค้า {text(field(row, 'tasks', 'รหัสลูกค้า'))} · เคส {text(field(row, 'tasks', 'รหัสเคส (ถ้ามี)')) || 'งานระดับลูกค้า ไม่มีรหัสเคส'}</p>
      <p>สถานะ {text(field(row, 'tasks', 'สถานะงาน')) || 'ยังไม่ระบุ'} · ผู้รับผิดชอบ {text(field(row, 'tasks', 'ผู้รับผิดชอบ')) || 'ยังไม่ระบุ'}</p><p>วัน {text(field(row, 'tasks', 'วันครบกำหนด')) || 'ยังไม่กำหนดวัน'} · {text(field(row, 'tasks', 'ประเภทวันกำหนด')) || 'ประเภทวันรอตรวจ'}</p>
      <p className={policy.blocked ? 'cf-alert' : 'cf-note'}>{policy.label}</p>{taskWarnings(row).map(w => <p className="cf-note" key={w}>{w}</p>)}<button type="button" onClick={() => onOpen(row.id)}>ดูรายละเอียดงาน {row.id}</button>
    </article>; })}</div>{!rows.length && <p className="cf-empty">ไม่พบงานที่ตรงกับตัวกรองจากข้อมูลที่โหลดสำเร็จ</p>}</section>;
}

