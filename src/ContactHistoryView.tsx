import { useEffect, useRef, useState } from 'react';
import type { ContactRow } from './contact-log';
import {
  formatContactDate, historyIndexes, historyText, type ContactCompany,
} from './contact-history';
import './contact-history.css';

type Props = {
  groups: ContactCompany[];
  totalCompanies: number;
  query: string;
  loading: boolean;
  loadError: string;
  disabled: boolean;
  onAdd: (customerId: string) => void;
  onEdit: (record: ContactRow) => void;
};
const detailFields = [
  ['person', 'ผู้ที่ติดต่อด้วย'],
  ['caseId', 'เคสที่เกี่ยวข้อง'],
  ['agreements', 'ข้อตกลงที่ยืนยันแล้ว'],
  ['suggestions', 'ข้อเสนอแนะ / รอตรวจ'],
  ['salesSheet', 'รุ่น Sales Sheet ที่ใช้'],
  ['verify', 'ผล Call Verify ก่อนติดต่อ'],
  ['verifiedAt', 'วันเวลาตรวจ Call Verify'],
  ['evidence', 'อ้างอิงหลักฐานสิทธิติดต่อ'],
] as const;

function businessDetails(value: unknown): string {
  const raw = historyText(value);
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

export default function ContactHistoryView({
  groups, totalCompanies, query, loading, loadError, disabled, onAdd, onEdit,
}: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedKey, setSelectedKey] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const dialog = useRef<HTMLElement>(null);
  const historyScroll = useRef<HTMLDivElement>(null);
  const selected = groups.find(group => group.key === selectedKey);
  const modalOpen = !!selected;
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visible = groups.slice(start, start + pageSize);
  const historyPages = Math.max(1, Math.ceil((selected?.records.length || 0) / 20));
  const currentHistoryPage = Math.min(historyPage, historyPages);
  const historyStart = (currentHistoryPage - 1) * 20;
  const records = selected?.records.slice(historyStart, historyStart + 20) || [];
  const totalContacts = groups.reduce((sum, group) => sum + group.records.length, 0);

  useEffect(() => { setPage(1); }, [query, pageSize]);
  useEffect(() => { historyScroll.current?.scrollTo?.(0, 0); }, [historyPage, selectedKey]);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('[data-history-close]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedKey('');
      }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), summary, a[href]'
      ) || [])].filter(node => {
        const details = node.closest('details:not([open])');
        return !details || (node.tagName === 'SUMMARY' && node.parentElement === details);
      });
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      if (previous?.isConnected && !document.querySelector('[role="dialog"]')) previous.focus();
    };
  }, [modalOpen]);

  const openHistory = (group: ContactCompany) => {
    setHistoryPage(1);
    setSelectedKey(group.key);
  };
  return (
    <section className="contact-history-view" aria-label="ประวัติการติดต่อแยกตามบริษัท" aria-busy={loading}>
      <p className="contact-company-summary" role="status">
        {loadError ? 'ข้อมูลที่โหลดก่อนหน้า · ' : ''}
        แสดง {groups.length} จาก {totalCompanies} บริษัท · ประวัติ {totalContacts} ครั้ง
      </p>
      <p className="small-note">บริษัทละหนึ่งแถว · คลิกจำนวนครั้งเพื่อดูประวัติทั้งหมด · นับทุกบันทึก รวมรายการที่ติดต่อไม่ได้</p>
      <div className="table-wrap contact-company-table-wrap">
        <table className="contact-company-table">
          <thead><tr><th>บริษัท</th><th>จำนวนครั้งที่ติดต่อ</th><th>ติดต่อล่าสุด</th><th>ผลการติดต่อล่าสุด</th><th>การดำเนินการ</th></tr></thead>
          <tbody>
            {visible.map(group => (
              <tr key={group.key}>
                <td data-label="บริษัท">
                  <strong>{group.companyName}</strong>
                  {group.registration && <small>เลขทะเบียน {group.registration}</small>}
                  {group.phone && <small>โทร. {group.phone}</small>}
                  {!group.linked && <small className="danger-text">รอตรวจการเชื่อมโยงบริษัท</small>}
                </td>
                <td data-label="จำนวนครั้งที่ติดต่อ">
                  <button
                    className="contact-count-button"
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={'ดูประวัติการติดต่อ ' + group.companyName + ' จำนวน ' + group.records.length + ' ครั้ง'}
                    onClick={() => openHistory(group)}
                  >
                    <strong>{group.records.length}</strong><span>ครั้ง</span>
                  </button>
                </td>
                <td data-label="ติดต่อล่าสุด">
                  {group.latest ? formatContactDate(group.latest.values[historyIndexes.contactedAt]) : 'วันเวลารอตรวจ'}
                  {!!group.unverifiedDates && <small>มี {group.unverifiedDates} รายการรอตรวจวันเวลา</small>}
                </td>
                <td data-label="ผลการติดต่อล่าสุด">
                  {group.latest ? historyText(group.latest.values[historyIndexes.outcome]) || 'ยังไม่ระบุ' : 'ดูรายละเอียดในประวัติ'}
                </td>
                <td data-label="การดำเนินการ">
                  <button className="button" type="button" disabled={disabled || !group.linked} onClick={() => onAdd(group.customerId)}
                    aria-label={'บันทึกการติดต่อเพิ่ม ' + group.companyName}>บันทึกเพิ่ม</button>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan={5} className="empty">
                <strong>{loading ? 'กำลังโหลดประวัติ…' : loadError ? 'ยังแสดงประวัติไม่ได้' : query.trim() ? 'ไม่พบบริษัทที่ตรงกับคำค้น' : 'ยังไม่มีประวัติการติดต่อ'}</strong>
                <p>{query.trim() ? 'ลองค้นหาชื่อบริษัทหรือรายละเอียดการติดต่ออื่น' : 'บันทึกการติดต่อครั้งแรกเพื่อเริ่มประวัติของบริษัท'}</p>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {!!groups.length && (
        <nav className="pagination" aria-label="แบ่งหน้าบริษัทที่ติดต่อ">
          <p role="status">แสดง {start + 1}–{Math.min(start + pageSize, groups.length)} จาก {groups.length} บริษัท</p>
          <label>บริษัทต่อหน้า<select value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>
            <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
          </select></label>
          <div className="pagination-buttons">
            <button className="button" type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>ก่อนหน้า</button>
            <span>หน้า {currentPage} / {pageCount}</span>
            <button className="button" type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>ถัดไป</button>
          </div>
        </nav>
      )}
      {selected && (
        <div className="modal-backdrop contact-history-backdrop" onClick={event => {
          if (event.target === event.currentTarget) setSelectedKey('');
        }}>
          <section ref={dialog} className="modal contact-history-modal" role="dialog" aria-modal="true" aria-labelledby="company-contact-history-title">
            <header className="modal-head">
              <div>
                <p className="eyebrow">ประวัติการติดต่อ</p>
                <h2 id="company-contact-history-title">{selected.companyName}</h2>
                <p className="small-note">ติดต่อทั้งหมด {selected.records.length} ครั้ง · วันเวลาที่ตรวจสอบได้เรียงจากใหม่ไปเก่า</p>
              </div>
              <button data-history-close className="button" type="button" onClick={() => setSelectedKey('')} aria-label="ปิดประวัติการติดต่อบริษัท">ปิด</button>
            </header>
            <div className="contact-history-scroll" ref={historyScroll}>
              {!selected.linked && <p className="contact-warning">ยังเชื่อมรายการนี้กับทะเบียนบริษัทไม่ได้ กรุณาตรวจสอบข้อมูลก่อนบันทึกเพิ่ม</p>}
              {!!selected.unverifiedDates && <p className="contact-warning">มี {selected.unverifiedDates} รายการที่ยังระบุวันเวลาแน่นอนไม่ได้ แสดงท้ายรายการตามข้อมูลเดิม</p>}
              {records.map((record, index) => (
                <article className="contact-history-entry" key={record.id + ':' + index} aria-label={'บันทึกการติดต่อรายการที่ ' + (historyStart + index + 1)}>
                  <header>
                    <h3>{formatContactDate(record.values[historyIndexes.contactedAt])}</h3>
                    <span>{historyText(record.values[historyIndexes.outcome]) || 'ยังไม่ระบุผล'}</span>
                  </header>
                  <p className="contact-history-channel">ช่องทาง: {historyText(record.values[historyIndexes.channel]) || 'ยังไม่ระบุ'}</p>
                  <h4>สรุปข้อเท็จจริง</h4>
                  <p className="contact-history-facts">{historyText(record.values[historyIndexes.facts]) || 'ยังไม่มีบันทึกรายละเอียด'}</p>
                  <details>
                    <summary>ดูข้อมูลเพิ่มเติม</summary>
                    <dl>
                      {detailFields.map(([key, label]) => (
                        <div key={key}><dt>{label}</dt><dd>{key === 'verifiedAt' && historyText(record.values[historyIndexes[key]])
                          ? formatContactDate(record.values[historyIndexes[key]])
                          : historyText(record.values[historyIndexes[key]]) || 'ยังไม่ระบุ'}</dd></div>
                      ))}
                    </dl>
                    {!!historyText(record.values[historyIndexes.businessJson]) && (
                      <div><h4>ข้อมูลธุรกิจเพิ่มเติมที่บันทึกไว้</h4><pre>{businessDetails(record.values[historyIndexes.businessJson])}</pre></div>
                    )}
                  </details>
                  <button className="button" type="button" disabled={disabled} onClick={() => {
                    setSelectedKey('');
                    onEdit(record);
                  }} aria-label={'แก้ไขประวัติการติดต่อรายการที่ ' + (historyStart + index + 1)}>แก้ไขบันทึกนี้</button>
                </article>
              ))}
            </div>
            <footer className="modal-foot contact-history-footer">
              <nav aria-label="แบ่งหน้าประวัติการติดต่อ">
                <span>รายการ {historyStart + 1}–{Math.min(historyStart + 20, selected.records.length)} จาก {selected.records.length}</span>
                {historyPages > 1 && <>
                  <button className="button" type="button" disabled={currentHistoryPage === 1} onClick={() => setHistoryPage(currentHistoryPage - 1)}>ก่อนหน้า</button>
                  <button className="button" type="button" disabled={currentHistoryPage === historyPages} onClick={() => setHistoryPage(currentHistoryPage + 1)}>ถัดไป</button>
                </>}
              </nav>
              <button className="button primary" type="button" disabled={disabled || !selected.linked} onClick={() => {
                setSelectedKey('');
                onAdd(selected.customerId);
              }}>บันทึกเพิ่มให้บริษัทนี้</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

