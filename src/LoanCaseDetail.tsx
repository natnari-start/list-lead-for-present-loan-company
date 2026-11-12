import { schemas } from './schema';
import { contactPolicy, field, text, presentMoney, type ReadModel, type Row } from './crm-read-model';
import { caseSummary, caseContacts } from './loan-case-view';
type Props = { id: string; model: ReadModel; onBack: () => void; onTask: (id: string) => void; onDocuments: () => void };
export default function LoanCaseDetail({ id, model, onBack, onTask, onDocuments }: Props) {
  const row = model.cases.get(id);
  if (!row) return <section><button type="button" onClick={onBack}>กลับรายการเดิม</button><p role="alert">ไม่พบรายการเดิมหลังรีเฟรช หรือความสัมพันธ์รอตรวจ</p></section>;
  const s = caseSummary(model, row); const customer = model.customers.get(s.customerId)!; const history = caseContacts(model, row); const policy = contactPolicy(customer);
  const contacts = (rows: Row[]) => rows.length ? <ul>{rows.map(c => <li key={c.id}>{c.id} · {text(field(c, 'contacts', 'วันเวลาติดต่อ')) || 'วันรอตรวจ'} · {text(field(c, 'contacts', 'ผลการติดต่อ'))}<p>{text(field(c, 'contacts', 'สรุปข้อเท็จจริง')) || 'ไม่มีสรุปที่บันทึกไว้'}</p></li>)}</ul> : <p>ไม่มีประวัติที่เชื่อมโยงในส่วนนี้</p>;
  return <section aria-label="รายละเอียดเคสสินเชื่อ"><button type="button" onClick={onBack}>กลับรายการเดิม</button><h3>{s.companyName} · {row.id}</h3><p className={policy.blocked ? 'cf-alert' : 'cf-note'} role={policy.blocked ? 'alert' : undefined}>{policy.label}</p>
    <h4>1. ข้อมูลเคสสินเชื่อ</h4><p className="cf-note">ค่าที่บันทึกไว้ ไม่ใช่การยืนยันผลอนุมัติจากระบบนี้</p><dl className="cf-grid">{schemas.find(spec => spec.key === 'cases')!.headers.map((h, i) => <div key={h}><dt>{h}</dt><dd>{[5, 12, 13].includes(i) ? presentMoney(row.values[i]) : text(row.values[i]) || 'ยังไม่ระบุ'}</dd></div>)}</dl>
    <h4>2. ข้อมูลลูกค้าเชื่อมโยง</h4><p>{s.customerId} · {s.companyName}</p><p>{text(field(customer, 'customers', 'จังหวัดที่ประกอบธุรกิจ')) || 'จังหวัดยังไม่ระบุ'} · {text(field(customer, 'customers', 'ประเภทธุรกิจ')) || 'ประเภทธุรกิจยังไม่ระบุ'}</p>
    <h4>3. ประวัติการติดต่อ</h4><p className="cf-note">วันเวลาที่แสดงเป็นค่าจากข้อมูลเดิม ไม่ใช่หลักฐานสิทธิ์ติดต่อครั้งถัดไป</p><h5>เฉพาะเคสนี้</h5>{contacts(history.specific)}<h5>ระดับลูกค้า ไม่มีรหัสเคส</h5>{contacts(history.customerOnly)}
    <h4>4. งานติดตามที่เกี่ยวข้อง</h4><p>งานค้าง {s.openCount} งาน</p>{s.tasks.length ? <ul>{[...s.tasks].sort((a,b) => Number(['เสร็จแล้ว','ยกเลิก'].includes(text(a.values[7]))) - Number(['เสร็จแล้ว','ยกเลิก'].includes(text(b.values[7]))) || a.id.localeCompare(b.id)).map(task => <li key={task.id}><button type="button" onClick={() => onTask(task.id)}>{task.id} · {text(field(task, 'tasks', 'งานที่ต้องทำ'))}</button> · {text(field(task, 'tasks', 'สถานะงาน'))}</li>)}</ul> : <p>ยังไม่มีงานติดตามที่เชื่อมกับเคสนี้</p>}
    <h4>5. รายการเอกสารที่เกี่ยวข้อง</h4><p>รายการเดิม {s.documents.legacyCounts.total} · รอตรวจ {s.documents.legacyCounts.receivedPending} · ตรวจครบตามสถานะเดิม {s.documents.legacyCounts.verified} · ต้องแก้ไข {s.documents.legacyCounts.needsRevision}</p><p>Legacy / ยังไม่จัดประเภท — ยังไม่สามารถคำนวณความครบของ Checklist ใหม่ หรือสรุปว่าผ่าน Prescreen / Full Doc</p><button type="button" onClick={onDocuments}>เปิดแท็บรายการเอกสาร</button><p className="cf-note">เลือกเคส {id} อีกครั้งในแท็บรายการเอกสารเดิม</p>
    <h4>6. ขั้นตอนถัดไปจากข้อมูลที่บันทึกไว้</h4><p>{s.openCount ? `มีงานค้าง ${s.openCount} งาน ดูรายละเอียดในส่วนงานติดตาม` : 'ยังไม่มีงานค้างที่บันทึกไว้สำหรับเคสนี้'}</p><p className="cf-note">ทำงานเสร็จไม่เปลี่ยนสถานะสินเชื่อหรือผลอนุมัติโดยอัตโนมัติ</p>
  </section>;
}

