import { useMemo, useRef, useState } from 'react';
import './phase3-synthetic.css';

type CaseId = 'SYN-K1' | 'SYN-K2' | 'SYN-K3';
type Stage = 'Prescreen' | 'Full Doc';
type Version = { id: string; months: string[]; supersedes: string | null };
type CaseState = {
  revision: number;
  loadedRevision: number;
  sets: Stage[];
  versions: Version[];
  review: 'not_reviewed' | 'complete';
  requested: boolean;
  audit: string[];
};

const cases: Array<{
  id: CaseId;
  customerId: string;
  label: string;
  appointment: string | null;
  doNotContact: boolean;
}> = [
  { id: 'SYN-K1', customerId: 'SYN-C1', label: 'ลูกค้าสังเคราะห์ A · เคส 1', appointment: '30 ต.ค. 2569', doNotContact: false },
  { id: 'SYN-K2', customerId: 'SYN-C1', label: 'ลูกค้าสังเคราะห์ A · เคส 2', appointment: null, doNotContact: false },
  { id: 'SYN-K3', customerId: 'SYN-C2', label: 'ลูกค้าสังเคราะห์ B · เคส 3', appointment: null, doNotContact: true },
];
const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const blank = (): Record<CaseId, CaseState> => ({
  'SYN-K1': { revision: 0, loadedRevision: 0, sets: [], versions: [], review: 'not_reviewed', requested: false, audit: [] },
  'SYN-K2': { revision: 0, loadedRevision: 0, sets: [], versions: [], review: 'not_reviewed', requested: false, audit: [] },
  'SYN-K3': { revision: 0, loadedRevision: 0, sets: [], versions: [], review: 'not_reviewed', requested: false, audit: [] },
});

export default function Phase3SyntheticLab() {
  const [caseId, setCaseId] = useState<CaseId>('SYN-K1');
  const [allState, setAllState] = useState(blank);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('พร้อมใช้งานด้วยข้อมูลสังเคราะห์');
  const [error, setError] = useState(false);
  const receipts = useRef(new Set<string>());
  const selected = cases.find(item => item.id === caseId)!;
  const current = allState[caseId];
  const latest = current.versions[current.versions.length - 1];
  const documentCreated = current.sets.length > 0;
  const receiptState = !latest ? 'missing' : latest.months.length === months.length ? 'received' : 'partial';
  const rawJson = useMemo(() => JSON.stringify({ legacy: { keep: true }, synthetic: true }, null, 2), []);

  const update = (next: CaseState) => setAllState(old => ({ ...old, [caseId]: next }));
  const fail = (text: string) => { setError(true); setMessage(text); };
  const succeed = (text: string) => { setError(false); setMessage(text); };
  const guardRevision = () => {
    if (current.revision !== current.loadedRevision) {
      fail(`revision conflict: หน้านี้โหลด revision ${current.loadedRevision} แต่เคสเป็น revision ${current.revision}`);
      return false;
    }
    return true;
  };
  const commit = (event: string, patch: Partial<CaseState>) => {
    const nextRevision = current.revision + 1;
    update({ ...current, ...patch, revision: nextRevision, loadedRevision: nextRevision, audit: [`r${nextRevision} · ${event}`, ...current.audit] });
  };
  const confirm = (stage: Stage) => {
    if (!guardRevision()) return;
    const operation = `${caseId}:confirm:${stage}`;
    if (receipts.current.has(operation) || current.sets.includes(stage)) {
      succeed(`retry operation เดิม: ไม่สร้างชุด ${stage} ซ้ำ`);
      return;
    }
    receipts.current.add(operation);
    commit(`ยืนยัน ${stage}${documentCreated ? ' · reuse รายการเดิม' : ' · สร้างรายการ Statement'}`, { sets: [...current.sets, stage] });
    succeed(stage === 'Full Doc' && documentCreated ? 'ใช้ Statement เดิมต่อใน Full Doc โดยไม่สร้างคำขอซ้ำ' : `ยืนยันชุด ${stage} แล้ว`);
  };
  const receive = (count: 3 | 6) => {
    if (!documentCreated) return fail('ต้องยืนยันชุดเอกสารก่อน');
    if (!guardRevision()) return;
    const previous = current.versions[current.versions.length - 1]?.id || null;
    const version: Version = { id: `SYN-V${current.versions.length + 1}`, months: months.slice(0, count), supersedes: previous };
    commit(`รับ ${version.id} จำนวน ${count}/6 เดือน`, { versions: [...current.versions, version], review: 'not_reviewed' });
    succeed(`รับเอกสารฉบับ ${version.id} แล้ว และยังเก็บฉบับก่อนหน้า`);
  };
  const reviewComplete = () => {
    if (!guardRevision()) return;
    if (!latest || latest.months.length !== months.length) return fail('เอกสารฉบับล่าสุดยังไม่ครบ 6 เดือน จึงตรวจเป็นครบไม่ได้');
    commit(`ตรวจ ${latest.id} ครบ 6/6 เดือน`, { review: 'complete' });
    succeed('ตรวจเอกสารฉบับล่าสุดครบแล้ว');
  };
  const requestFollowUp = () => {
    if (!documentCreated) return fail('ต้องมีรายการเอกสารก่อนบันทึกการติดตาม');
    if (!guardRevision()) return;
    if (selected.doNotContact) return fail('บล็อกการติดตาม: ประวัติสังเคราะห์ระบุขอไม่ให้ติดต่ออีก');
    if ((selected.appointment || current.requested) && !reason.trim()) return fail('การติดตามก่อนวันนัดหรือการติดตามซ้ำต้องระบุเหตุผล');
    commit(`บันทึก REQUESTED audit · เหตุผล: ${reason.trim() || 'ติดตามตามกระบวนการ'}`, { requested: true });
    setReason('');
    succeed('บันทึก audit แล้ว ไม่มีการโทร ส่งข้อความ หรือสร้างงานจริง');
  };
  const simulateConflict = () => {
    update({ ...current, revision: current.revision + 1, audit: [`r${current.revision + 1} · จำลองการแก้จากอีกหน้าต่าง`, ...current.audit] });
    succeed('จำลองข้อมูลเปลี่ยนจากอีกหน้าต่างแล้ว ลองทำรายการเพื่อดู conflict');
  };
  const reloadRevision = () => {
    update({ ...current, loadedRevision: current.revision });
    succeed(`โหลด revision ${current.revision} ล่าสุดแล้ว`);
  };
  const reset = () => {
    setAllState(blank());
    receipts.current.clear();
    setReason('');
    succeed('ล้างข้อมูลจำลองทั้งหมดแล้ว');
  };

  return (
    <main className="p3-shell">
      <header className="p3-hero">
        <p className="p3-eyebrow">SME FREEDOM DESK · PHASE 3</p>
        <h1>ห้องทดลองเอกสารและการติดตาม</h1>
        <p>ข้อมูลสังเคราะห์ใน browser เท่านั้น · ไม่โหลดข้อมูลลูกค้า · ไม่เขียน Google Sheets</p>
        <a href="./">กลับหน้าหลัก</a>
      </header>

      <section className="p3-notice">หน้านี้ใช้ตรวจขั้นตอนและ guardrail เท่านั้น ข้อมูลจะหายเมื่อรีเฟรชหน้า และไม่ใช่ checklist ที่ธนาคารอนุมัติ</section>
      <section className="p3-toolbar">
        <label>เลือกเคสด้วยรหัส
          <select value={caseId} onChange={event => { setCaseId(event.target.value as CaseId); setReason(''); }}>
            {cases.map(item => <option key={item.id} value={item.id}>{item.label} ({item.id})</option>)}
          </select>
        </label>
        <button type="button" className="p3-secondary" onClick={reset}>เริ่มใหม่ทั้งหมด</button>
      </section>
      <p className={error ? 'p3-message p3-error' : 'p3-message'} role="status" aria-live="polite">{message}</p>

      <section className="p3-grid">
        <article className="p3-card">
          <span className="p3-step">01</span><h2>ชุดเอกสาร</h2>
          <p><strong>{selected.customerId} / {caseId}</strong></p>
          <p>Statement · SYN-OWNER-1 · SYN-ACCOUNT-1 · ม.ค.–มิ.ย. 2569</p>
          <div className="p3-actions">
            <button type="button" onClick={() => confirm('Prescreen')}>ยืนยัน Prescreen</button>
            <button type="button" onClick={() => confirm('Full Doc')}>ยืนยัน Full Doc / reuse</button>
          </div>
          <p>ชุดที่มี: {current.sets.length ? current.sets.join(', ') : 'ยังไม่มี'} · จำนวนรายการ: {documentCreated ? 1 : 0}</p>
        </article>

        <article className="p3-card">
          <span className="p3-step">02</span><h2>รับและตรวจฉบับเอกสาร</h2>
          <p>รับ: <strong>{receiptState}</strong> · ตรวจ: <strong>{current.review}</strong></p>
          <div className="p3-actions">
            <button type="button" onClick={() => receive(3)}>รับฉบับ 3/6 เดือน</button>
            <button type="button" onClick={() => receive(6)}>รับฉบับแก้ไข 6/6 เดือน</button>
            <button type="button" className="p3-secondary" onClick={reviewComplete}>ตรวจเป็นครบ</button>
          </div>
          <ol className="p3-history">
            {current.versions.map(version => <li key={version.id}>{version.id}: {version.months.length}/6 เดือน · ต่อจาก {version.supersedes || 'ไม่มี'}</li>)}
          </ol>
        </article>

        <article className="p3-card">
          <span className="p3-step">03</span><h2>ติดตามและข้อห้าม</h2>
          <p>{selected.doNotContact ? 'ข้อห้าม: ขอไม่ให้ติดต่ออีก' : selected.appointment ? `มีนัด ${selected.appointment} — ต้องระบุเหตุผลเมื่อติดตามก่อนนัด` : 'ไม่มีข้อห้ามในสถานการณ์จำลองนี้'}</p>
          <label>เหตุผล
            <textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="ระบุเหตุผลเมื่อติดตามก่อนนัดหรือซ้ำ" />
          </label>
          <button type="button" onClick={requestFollowUp}>บันทึก REQUESTED audit</button>
        </article>

        <article className="p3-card">
          <span className="p3-step">04</span><h2>แก้พร้อมกันและข้อมูลเดิม</h2>
          <p>หน้าปัจจุบัน revision {current.loadedRevision} · เคส revision {current.revision}</p>
          <div className="p3-actions">
            <button type="button" onClick={simulateConflict}>จำลองอีกหน้าต่างแก้ข้อมูล</button>
            <button type="button" className="p3-secondary" onClick={reloadRevision}>โหลด revision ล่าสุด</button>
          </div>
          <details><summary>Raw JSON เดิมที่ต้องคงไว้</summary><pre>{rawJson}</pre></details>
        </article>
      </section>

      <section className="p3-card">
        <h2>Audit ของ {caseId}</h2>
        {current.audit.length ? <ul className="p3-history">{current.audit.map((event, index) => <li key={`${event}-${index}`}>{event}</li>)}</ul> : <p>ยังไม่มีเหตุการณ์</p>}
      </section>
    </main>
  );
}

