import { useMemo, useState } from 'react';
import { buildDocumentView, type SheetRow } from './document-workflow';
import type { DocumentStage } from './document-catalog';

type Props = {
  cases: readonly SheetRow[];
  customers: readonly SheetRow[];
  documents: readonly SheetRow[];
};
/** Display-only document view. Never invokes any API or dispatches writes. */
export default function DocumentChecklist({ cases, customers, documents }: Props) {
  const [caseId, setCaseId] = useState('');
  const [stage, setStage] = useState<DocumentStage>('prescreen');
  const selected = cases.find(item => item.id === caseId);
  const customer = selected && customers.find(item => item.id === String(selected.values[1] ?? ''));
  const view = useMemo(() => buildDocumentView(caseId, documents, stage), [caseId, documents, stage]);
  const noContact = customer && ['ขอระงับ', 'ส่งดำเนินการแล้ว'].includes(String(customer.values[20] ?? ''));
  return <section className="document-checklist" aria-label="เช็คลิสต์เอกสารแบบอ่านอย่างเดียว">
    <header><h2>รายการเอกสาร Prescreen → Full Doc</h2>
      <p>แสดงข้อมูลเพื่อการตรวจทานเท่านั้น • ข้อกำหนดรายการรอยืนยันจากผู้รับผิดชอบผลิตภัณฑ์ • ไม่ใช่ผลอนุมัติสินเชื่อ</p></header>
    <label htmlFor="document-case-picker">เลือกเคสสินเชื่อ</label>
    <select id="document-case-picker" value={caseId} onChange={event => setCaseId(event.target.value)}>
      <option value="">— เลือกเคส —</option>
      {cases.map(item => <option key={item.id} value={item.id}>{item.id} · {String(customers.find(c => c.id === String(item.values[1] ?? ''))?.values[2] ?? 'ไม่พบชื่อลูกค้า')}</option>)}
    </select>
    {selected ? <>
      <p>เคส: <strong>{selected.id}</strong> | บริษัท: {String(customer?.values[2] ?? 'ไม่พบข้อมูลลูกค้า')}</p>
      {noContact && <p role="alert">มีคำขอระงับการติดต่อ — ห้ามสร้างกิจกรรมติดต่อโดยอัตโนมัติ</p>}
      <div role="group" aria-label="ขั้นตอนเอกสาร">
        <button type="button" aria-pressed={stage === 'prescreen'} onClick={() => setStage('prescreen')}>Prescreen</button>
        <button type="button" aria-pressed={stage === 'full_doc'} onClick={() => setStage('full_doc')}>Full Doc</button>
      </div>
      <h3>รายการที่คาดว่าต้องใช้ ({view.catalog.length}) — ข้อเสนอรอยืนยัน</h3>
      <ul>{view.catalog.map(item => <li key={item.code}>
        <strong>{item.code}</strong> · {item.label} <small>({item.applicability}; นโยบายรอยืนยัน)</small>
        {item.note && <p>{item.note}</p>}
      </li>)}</ul>
      <h3>เอกสารที่บันทึกไว้แล้ว — Legacy / ยังไม่จัดประเภทรายการ</h3>
      <p>พบ {view.legacyCounts.total} รายการ · รอตรวจ {view.legacyCounts.receivedPending} · ตรวจครบตามสถานะเดิม {view.legacyCounts.verified} · ต้องแก้ไข {view.legacyCounts.needsRevision}</p>
      <p>ยังไม่สามารถคำนวณอัตราความครบของ Checklist ใหม่จากเอกสารเดิมที่ไม่มี Document Code และ Stage ได้</p>
      <ul>{view.legacyDocuments.map(doc => <li key={doc.id}>
        <strong>{doc.id}</strong> · {doc.category || 'ไม่ระบุประเภท'} — {doc.status}
        {doc.issue && <p>ประเด็น: {doc.issue}</p>}
      </li>)}</ul>
      {!view.legacyDocuments.length && <p>ไม่มีรายการเอกสารที่บันทึกไว้สำหรับเคสนี้ ไม่ถือว่าได้รับหรือขาดเอกสารรายการใดแล้ว</p>}
    </> : <p>เลือกเคสเพื่อดู Checklist และข้อมูลเอกสารเดิม</p>}
  </section>;
}

