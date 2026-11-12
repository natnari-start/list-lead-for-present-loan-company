import { useEffect, useMemo, useRef, useState } from 'react';
import { schemas } from './schema';
import { buildReadModel, field, text, type ReadData } from './crm-read-model';
import { bangkokToday, taskStatuses, dateKinds } from './follow-up-view';
import LoanCaseOverview from './LoanCaseOverview';
import LoanCaseDetail from './LoanCaseDetail';
import FollowUpDashboard from './FollowUpDashboard';
import FollowUpTaskDetail from './FollowUpTaskDetail';
import './case-follow-up.css';

type Tab = 'cases' | 'tasks';
type View = { kind: 'list' | 'case' | 'task'; id: string; tab: Tab };
type Props = { data: ReadData; part: Tab; loaded: boolean; loading: boolean; loadError: string; fetchedAt: string; onPartChange: (part: Tab | 'documents') => void; datesVerified?: boolean; today?: string };
export default function CaseFollowUpWorkbench({ data, part, loaded, loading, loadError, fetchedAt, onPartChange, datesVerified = false, today: fixedToday }: Props) {
  const model = useMemo(() => buildReadModel(data), [data]);
  const [queries, setQueries] = useState({ cases: '', tasks: '' });
  const [caseStatus, setCaseStatus] = useState(''); const [taskStatus, setTaskStatus] = useState('');
  const [caseOwner, setCaseOwner] = useState(''); const [taskOwner, setTaskOwner] = useState('');
  const [pending, setPending] = useState(''); const [kind, setKind] = useState(''); const [group, setGroup] = useState(''); const [caseId, setCaseId] = useState('');
  const [dnc, setDnc] = useState(false); const [showIssues, setShowIssues] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list', id: '', tab: part });
  const [history, setHistory] = useState<View[]>([]);
  const internal = useRef(false); const heading = useRef<HTMLHeadingElement>(null);
  const focusStack = useRef<Array<{ label: string; scroll: number }>>([]);
  const restoreFocus = useRef<{ label: string; scroll: number } | null>(null);
  const [today, setToday] = useState(() => fixedToday || bangkokToday());
  useEffect(() => { if (fixedToday) { setToday(fixedToday); return; } const timer = window.setInterval(() => setToday(bangkokToday()), 30000); return () => window.clearInterval(timer); }, [fixedToday]);
  useEffect(() => {
    if (internal.current) { internal.current = false; return; }
    setView({ kind: 'list', id: '', tab: part }); setHistory([]); focusStack.current = [];
  }, [part]);
  useEffect(() => {
    const restore = restoreFocus.current;
    if (restore) { const target = [...(heading.current?.parentElement?.querySelectorAll<HTMLButtonElement>('button') || [])].find(b => (b.getAttribute('aria-label') || b.textContent) === restore.label); (target || heading.current)?.focus(); window.scrollTo?.(0, restore.scroll); restoreFocus.current = null; }
    else if (view.kind !== 'list') heading.current?.focus();
  }, [view]);
  const go = (next: View) => {
    focusStack.current.push({ label: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '', scroll: window.scrollY });
    setHistory(h => [...h, view]); setView(next);
    if (next.tab !== part) { internal.current = true; onPartChange(next.tab); }
  };
  const back = () => {
    const previous = history[history.length - 1] || { kind: 'list' as const, id: '', tab: part };
    restoreFocus.current = focusStack.current.pop() || { label: '', scroll: 0 };
    setHistory(h => h.slice(0, -1)); setView(previous);
    if (previous.tab !== part) { internal.current = true; onPartChange(previous.tab); }
  };
  const owners = [...new Set([...(part === 'cases' ? model.cases : model.tasks).values()].map(row => text(field(row, part, part === 'cases' ? 'ผู้รับช่วงงาน' : 'ผู้รับผิดชอบ'))).filter(Boolean))].sort();
  const statusOptions: readonly string[] = part === 'cases' ? schemas.find(s => s.key === 'cases')!.options['7'] : taskStatuses;
  return <section className="cf-workbench" aria-label="เคสและงานติดตามแบบอ่านอย่างเดียว" aria-busy={loading}>
    <h2 ref={heading} tabIndex={-1}>{view.kind === 'case' ? 'รายละเอียดเคสสินเชื่อ' : view.kind === 'task' ? 'รายละเอียดงานติดตาม' : part === 'cases' ? 'ภาพรวมเคสสินเชื่อ' : 'งานติดตามของคุณ'}</h2>
    <p className="cf-note">มุมมองอ่านอย่างเดียว · ใช้รหัสถาวรเชื่อมข้อมูล · ไม่มีการสร้างวันนัดหรือกิจกรรมติดต่อ</p>
    {loading ? <p role="status">กำลังโหลดข้อมูล…</p> : loadError ? <p role="alert">ยังตรวจข้อมูลไม่ได้: {loadError}{loaded ? ' · ข้อมูลเดิมยังอยู่ แต่ไม่นำมาสรุปยอดปัจจุบัน' : ''}</p> : !loaded ? <p role="status">ยังไม่ได้โหลดข้อมูลสำเร็จ</p> : <>
      <p className="cf-note">ดึงข้อมูลสำเร็จเมื่อ {fetchedAt || 'ยังไม่ทราบเวลา'} · ไม่ใช่เวลาปรับปรุงของแต่ละรายการ</p>
      {!datesVerified && <p className="cf-alert" role="status">วันครบกำหนดจากแหล่งข้อมูลยังรอตรวจยืนยัน งานที่มีวันที่จะแสดงเป็น “วันรอตรวจ” และยังไม่นับเป็นวันนี้หรือเกินกำหนด</p>}
      {!!model.issues.length && <div className="cf-alert"><button type="button" aria-expanded={showIssues} onClick={() => setShowIssues(s => !s)}>ข้อมูลเชื่อมโยงรอตรวจ {model.issues.length} รายการ</button>{showIssues && <ul>{model.issues.map((issue, i) => <li key={`${issue.part}-${i}`}>{issue.part} · {issue.id || 'รหัสว่าง'} · {issue.reason}</li>)}</ul>}</div>}
      {view.kind === 'list' && <div className="cf-filters">
        <label>ค้นหา{part === 'cases' ? 'เคส' : 'งาน'}<input type="search" value={queries[part]} onChange={e => setQueries(q => ({ ...q, [part]: e.target.value }))} /></label>
        <label>สถานะ<select value={part === 'cases' ? caseStatus : taskStatus} onChange={e => part === 'cases' ? setCaseStatus(e.target.value) : setTaskStatus(e.target.value)}><option value="">ทั้งหมด</option>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>{part === 'cases' ? 'ผู้รับช่วงงาน' : 'ผู้รับผิดชอบ'}<select value={part === 'cases' ? caseOwner : taskOwner} onChange={e => part === 'cases' ? setCaseOwner(e.target.value) : setTaskOwner(e.target.value)}><option value="">ทั้งหมด</option>{owners.map(s => <option key={s}>{s}</option>)}</select></label>
        {part === 'cases' ? <label>งานค้าง<select value={pending} onChange={e => setPending(e.target.value)}><option value="">ทั้งหมด</option><option value="yes">มีงานค้าง</option><option value="no">ไม่มีงานค้าง</option></select></label> : <label>ประเภทวัน<select value={kind} onChange={e => setKind(e.target.value)}><option value="">ทั้งหมด</option>{dateKinds.map(s => <option key={s}>{s}</option>)}</select></label>}
        <label className="cf-check"><input type="checkbox" checked={dnc} onChange={e => setDnc(e.target.checked)} />เฉพาะมีคำขอระงับการติดต่อ</label>
        {(queries[part] || (part === 'cases' ? caseStatus || caseOwner || pending : taskStatus || taskOwner || kind || group || caseId) || dnc) && (
          <button
            type="button"
            onClick={() => {
              setQueries(q => ({ ...q, [part]: '' }));
              if (part === 'cases') {
                setCaseStatus('');
                setCaseOwner('');
                setPending('');
              } else {
                setTaskStatus('');
                setTaskOwner('');
                setKind('');
                setGroup('');
                setCaseId('');
              }
              setDnc(false);
            }}
          >
            ล้างตัวกรองทั้งหมด
          </button>
        )}
      </div>}
      {view.kind === 'case' ? <LoanCaseDetail id={view.id} model={model} onBack={back} onTask={id => go({ kind: 'task', id, tab: 'tasks' })} onDocuments={() => onPartChange('documents')} />
        : view.kind === 'task' ? <FollowUpTaskDetail id={view.id} model={model} today={today} datesVerified={datesVerified} onBack={back} onCase={id => go({ kind: 'case', id, tab: 'cases' })} />
        : part === 'cases' ? <LoanCaseOverview model={model} query={queries.cases} status={caseStatus} owner={caseOwner} pending={pending} dnc={dnc} onOpen={id => go({ kind: 'case', id, tab: 'cases' })} onTasks={id => { setCaseId(id); setGroup(''); onPartChange('tasks'); }} />
        : <FollowUpDashboard model={model} today={today} datesVerified={datesVerified} query={queries.tasks} status={taskStatus} owner={taskOwner} kind={kind} group={group} caseId={caseId} dnc={dnc} onGroup={setGroup} onOpen={id => go({ kind: 'task', id, tab: 'tasks' })} />}
    </>}
  </section>;
}

