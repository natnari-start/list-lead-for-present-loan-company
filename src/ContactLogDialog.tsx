import { useEffect, useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import { schemas } from './schema';
import {
  emptyPhoneContactForm,
  phoneContactValues, validateContactValues, type PhoneContactForm, type ContactRow,
} from './contact-log';

type Props = {
  customers: ContactRow[];
  cases: ContactRow[];
  context: { customerId?: string; caseId?: string };
  disabled: boolean;
  onClose: () => void;
  onSaved: (record: ContactRow, replayed: boolean) => void;
};
type Payload = { part: string; requestId: string; values: Array<string | null> };

export default function ContactLogDialog({ customers, cases, context, disabled, onClose, onSaved }: Props) {
  const [form, setForm] = useState(() => emptyPhoneContactForm(context));
  const [requestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const submitted = useRef<Payload | null>(null);
  const dirty = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const frozen = saving || uncertain;
  const customerHeaders = schemas.find(spec => spec.key === 'customers')!.headers as readonly string[];
  const caseHeaders = schemas.find(spec => spec.key === 'cases')!.headers as readonly string[];
  const company = (row: ContactRow) => String(row.values[customerHeaders.indexOf('ชื่อบริษัท')] || 'ไม่ระบุชื่อ');
  const matchingCases = cases.filter(row =>
    String(row.values[caseHeaders.indexOf('รหัสลูกค้า')]) === form.customerId
  );

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.querySelector<HTMLElement>('select')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!lock.current && (!dirty.current || window.confirm('ปิดหน้าต่างและละทิ้งโน้ตที่ยังไม่บันทึก?'))) close.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
      ) || [])];
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
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('[data-add-contact]')?.focus();
    };
  }, []);

  const set = <K extends keyof PhoneContactForm>(key: K, value: PhoneContactForm[K]) => {
    dirty.current = true;
    setForm(current => ({
      ...current,
      [key]: value,
      ...(key === 'customerId' ? { caseId: '' } : {}),
    }));
  };

  function cancel() {
    if (lock.current) return;
    if (dirty.current && !window.confirm('ปิดหน้าต่างและละทิ้งโน้ตที่ยังไม่บันทึก?')) return;
    onClose();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || disabled) return;
    if (!submitted.current || !uncertain) {
      const values = phoneContactValues(form);
      const validation = validateContactValues(values);
      if (validation) { setError(validation); return; }
      if (!customers.some(row => row.id === form.customerId)) {
        setError('กรุณาเลือกบริษัทที่มีอยู่');
        return;
      }
      if (form.caseId && !matchingCases.some(row => row.id === form.caseId)) {
        setError('เคสที่เลือกไม่ตรงกับบริษัท');
        return;
      }
      submitted.current = { part: 'contacts', requestId, values };
    }
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      if (!await auth.getUser()) {
        setNeedsLogin(true);
        throw new Error('กรุณาตรวจสอบการเข้าสู่ระบบ โน้ตยังอยู่ในหน้าต่างนี้');
      }
      const response = await api.post('/api/records', submitted.current);
      const result = response.data as { record?: ContactRow; created?: boolean; replayed?: boolean };
      if (!result.record?.id || !Array.isArray(result.record.values)) {
        throw new Error('ยังไม่ได้รับผลยืนยัน กรุณาตรวจสอบคำขอเดิมอีกครั้ง');
      }
      onSaved(result.record, !!result.replayed);
    } catch (cause) {
      const failure = cause as { response?: { status?: number; data?: { error?: string } } };
      const status = failure.response?.status;
      if (status === 401 || status === 403) setNeedsLogin(true);
      const ambiguous = !status || status >= 500;
      setUncertain(ambiguous);
      setError((failure.response?.data?.error || (cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')) +
        (ambiguous ? ' · โน้ตยังอยู่ กดตรวจสอบ/ลองคำขอเดิมอีกครั้งเพื่อป้องกันรายการซ้ำ' : ''));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  async function checkSession() {
    if (lock.current) return;
    try {
      if (!await auth.getUser()) throw new Error('กรุณาเข้าสู่ระบบใหม่ แล้วตรวจสอบสิทธิ์อีกครั้ง โน้ตยังอยู่ในหน้าต่างนี้');
      await api.get('/api/session');
      setNeedsLogin(false);
      setError('ยืนยันสิทธิ์แล้ว กรุณาบันทึกคำขอเดิมอีกครั้ง');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ยังยืนยันสิทธิ์ไม่ได้ โน้ตยังอยู่ในหน้าต่างนี้');
    }
  }

  return (
    <div className="modal-backdrop contact-dialog-backdrop">
      <form ref={root} className="modal contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title" onSubmit={save}>
        <header className="modal-head">
          <div><h2 id="contact-dialog-title">เพิ่มรายการประวัติการติดต่อ</h2><p className="small-note">บันทึกผลการโทรและโน้ตของบริษัทนี้</p></div>
          <button className="button" type="button" disabled={saving} onClick={cancel} aria-label="ปิดฟอร์มประวัติการติดต่อ">ปิด</button>
        </header>
        <div className="contact-dialog-scroll">
          {error && <div className="error-banner" role="alert">{error}</div>}
          {needsLogin && <button className="button" type="button" onClick={() => void checkSession()}>ตรวจสอบสิทธิ์การเข้าสู่ระบบอีกครั้ง</button>}
          {disabled && <p role="alert">ยังบันทึกไม่ได้ กรุณารอการเชื่อมต่อ Google Sheets</p>}
          <fieldset disabled={frozen} className="contact-fields">
            <legend>ข้อมูลการติดต่อ</legend>
            <label><span>บริษัท *</span>
              <select required value={form.customerId} onChange={event => set('customerId', event.target.value)}>
                <option value="">— เลือกบริษัท —</option>
                {customers.map(row => <option key={row.id} value={row.id}>{company(row)}</option>)}
              </select>
            </label>
            <label><span>เคสที่เกี่ยวข้อง (ถ้ามี)</span>
              <select value={form.caseId} disabled={!form.customerId || frozen} onChange={event => set('caseId', event.target.value)}>
                <option value="">— ไม่ระบุเคส —</option>
                {matchingCases.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
              </select>
            </label>
            <label><span>วันเวลาที่ติดต่อจริง (เวลาไทย) *</span>
              <input required type="datetime-local" value={form.contactedAt} onChange={event => set('contactedAt', event.target.value)} />
            </label>
            <label><span>ช่องทาง</span><input required value={form.channel} maxLength={20000}
              onChange={event => set('channel', event.target.value)} /></label>
            <label><span>ผลการติดต่อ *</span>
              <input required value={form.outcome} maxLength={20000}
                onChange={event => set('outcome', event.target.value)} />
            </label>
            <label><span>โน้ต (ไม่บังคับ)</span>
              <textarea value={form.note} maxLength={20000} rows={5}
                onChange={event => set('note', event.target.value)}
                placeholder="พิมพ์บันทึกการติดต่อได้ตามต้องการ" />
              <small>{form.note.length.toLocaleString('th-TH')} / 20,000 ตัวอักษร</small>
            </label>
          </fieldset>
        </div>
        <footer className="modal-foot contact-dialog-footer">
          <small>บันทึกประวัติการติดต่อใหม่</small>
          <button className="button" type="button" disabled={saving} onClick={cancel}>ยกเลิก</button>
          <button className="button primary" type="submit" disabled={saving || disabled || needsLogin}>
            {saving ? 'กำลังบันทึก…' : uncertain ? 'ตรวจสอบ/ลองคำขอเดิมอีกครั้ง' : 'บันทึกประวัติ'}
          </button>
        </footer>
      </form>
    </div>
  );
}


