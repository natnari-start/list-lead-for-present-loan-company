import { useEffect, useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import { schemas } from './schema';
import {
  contactSpec, contactValues, draftContact, emptyContactForm, fullContactOutcome,
  isContactDateTime, validateContactValues, type ContactForm, type ContactRow,
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
  const [form, setForm] = useState(() => emptyContactForm(context));
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<ReturnType<typeof draftContact> | null>(null);
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

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.querySelector<HTMLElement>('select')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!lock.current && (!dirty.current || window.confirm('ปิดหน้าต่างและละทิ้งร่างที่ยังไม่บันทึก? หากส่งคำขอไปแล้วให้ตรวจประวัติก่อนเริ่มรายการใหม่'))) close.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary') || [])]
        .filter(node => !node.closest('details:not([open])') || node.tagName === 'SUMMARY');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('[data-add-contact]')?.focus();
    };
  }, []);

  const set = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) => {
    dirty.current = true;
    setDraft(null);
    setForm(current => ({ ...current, [key]: value,
      ...(key === 'customerId' ? { caseId: '', person: '' } : {}),
      ...(key === 'outcome' ? { callbackAllowed: false } : {}),
    }));
  };
  const full = fullContactOutcome(form.outcome);
  const callback = form.outcome === 'ขอคุยใหม่';
  const frozen = saving || uncertain;
  const customerHeaders = schemas.find(spec => spec.key === 'customers')!.headers as readonly string[];
  const caseHeaders = schemas.find(spec => spec.key === 'cases')!.headers as readonly string[];
  const company = (row: ContactRow) => String(row.values[customerHeaders.indexOf('ชื่อบริษัท')] || 'ไม่ระบุชื่อ');
  const matchingCases = cases.filter(row => String(row.values[caseHeaders.indexOf('รหัสลูกค้า')]) === form.customerId);
  const options = (header: string) => contactSpec.options[String(contactSpec.headers.indexOf(header))] || [];

  function cancel() {
    if (lock.current) return;
    if (dirty.current && !window.confirm('ปิดหน้าต่างและละทิ้งร่างที่ยังไม่บันทึก? หากส่งคำขอไปแล้วให้ตรวจประวัติก่อนเริ่มรายการใหม่')) return;
    onClose();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || disabled) return;
    const values = contactValues(form);
    const validation = validateContactValues(values);
    if (!submitted.current || !uncertain) {
      if (validation) { setError(validation); return; }
      if (!customers.some(row => row.id === form.customerId)) { setError('กรุณาเลือกบริษัทที่มีอยู่'); return; }
      if (form.caseId && !matchingCases.some(row => row.id === form.caseId)) { setError('เคสที่เลือกไม่ตรงกับบริษัท'); return; }
      if (full && !form.facts.trim()) { setError('กรุณาระบุข้อเท็จจริงที่ทราบจากการติดต่อ'); return; }
      if (form.callbackAt && callback && !isContactDateTime(form.callbackAt)) { setError('กรุณาตรวจวันเวลาติดต่อกลับ'); return; }
      if (full && form.productPresented && !form.salesSheet.trim()) { setError('กรุณาระบุรุ่น Sales Sheet ที่ใช้จริง'); return; }
      submitted.current = { part: 'contacts', requestId, values };
    }
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      if (!await auth.getUser()) { setNeedsLogin(true); throw new Error('กรุณายืนยันการเข้าสู่ระบบ ร่างยังอยู่ในหน้าต่างนี้'); }
      const response = await api.post('/api/records', submitted.current);
      const result = response.data as { record?: ContactRow; created?: boolean; replayed?: boolean };
      if (!result.record?.id || !Array.isArray(result.record.values)) throw new Error('ยังไม่ได้รับผลยืนยัน กรุณาตรวจสอบคำขอเดิมอีกครั้ง');
      onSaved(result.record, !!result.replayed);
    } catch (cause) {
      const failure = cause as { response?: { status?: number; data?: { error?: string } } };
      const status = failure.response?.status;
      if (status === 401 || status === 403) setNeedsLogin(true);
      const ambiguous = !status || status >= 500;
      setUncertain(ambiguous);
      setError((failure.response?.data?.error || (cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')) +
        (ambiguous ? ' · ร่างเดิมยังอยู่ กดตรวจสอบ/ลองคำขอเดิมอีกครั้งเพื่อป้องกันรายการซ้ำ' : ''));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  async function signIn() {
    if (lock.current) return;
    try {
      await auth.signIn({ scope: 'openid email profile offline_access' });
      await api.get('/api/session');
      setNeedsLogin(false);
      setError('ยืนยันการเข้าสู่ระบบแล้ว กรุณาบันทึกคำขอเดิมอีกครั้ง');
    } catch { setError('ยังยืนยันสิทธิ์ไม่ได้ ร่างยังอยู่ในหน้าต่างนี้'); }
  }

  function applyDraft() {
    if (!draft) return;
    const replacing = (['facts', 'agreements', 'suggestions'] as const).some(key => form[key].trim() && form[key].trim() !== draft[key]);
    if (replacing && !window.confirm('ยืนยันนำร่างที่ตรวจแล้วไปแทนข้อความเดิมในฟอร์ม?')) return;
    dirty.current = true;
    setForm(current => ({ ...current, ...draft }));
    setDraft(null);
  }

  return (
    <div className="modal-backdrop contact-dialog-backdrop">
      <form ref={root} className="modal contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title" onSubmit={save}>
        <div className="modal-head">
          <div><h2 id="contact-dialog-title">เพิ่มรายการประวัติการติดต่อ</h2><p className="small-note">ข้อความที่พนักงานบันทึก · ไม่ใช่ไฟล์เสียงหรือหลักฐานคำยินยอมของธนาคาร</p></div>
          <button className="button" type="button" disabled={saving} onClick={cancel} aria-label="ปิดฟอร์มประวัติการติดต่อ">ปิด</button>
        </div>
        <div className="contact-dialog-scroll">
          {error && <div className="error-banner" role="alert">{error}</div>}
          {needsLogin && <button className="button" type="button" onClick={() => void signIn()}>ยืนยันการเข้าสู่ระบบโดยเก็บร่างไว้</button>}
          {disabled && <p role="alert">ยังบันทึกไม่ได้ กรุณารอการเชื่อมต่อและตรวจสิทธิ์ Google Sheets</p>}
          <fieldset disabled={frozen} className="contact-fields">
            <legend>รายการและผลการติดต่อ</legend>
            <label><span>บริษัท / รหัสลูกค้า *</span><select required value={form.customerId} onChange={event => set('customerId', event.target.value)}>
              <option value="">— เลือกบริษัท —</option>{customers.map(row => <option key={row.id} value={row.id}>{company(row)} · {row.id}</option>)}
            </select></label>
            <label><span>รหัสเคส (ถ้ามี)</span><select value={form.caseId} disabled={!form.customerId || frozen} onChange={event => set('caseId', event.target.value)}>
              <option value="">— ไม่ระบุเคส —</option>{matchingCases.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
            </select></label>
            <label><span>วันเวลาที่ติดต่อจริง (เวลาไทย) *</span><input required type="datetime-local" value={form.contactedAt} onInput={event => set('contactedAt', event.currentTarget.value)} onChange={event => set('contactedAt', event.target.value)} /></label>
            <label><span>ช่องทาง *</span><select required value={form.channel} onChange={event => set('channel', event.target.value)}>
              <option value="">— เลือกช่องทาง —</option>{options('ช่องทาง').map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label><span>ผลการติดต่อ *</span><select required value={form.outcome} onChange={event => set('outcome', event.target.value)}>
              <option value="">— เลือกผลการติดต่อ —</option>{options('ผลการติดต่อ').map(value => <option key={value}>{value}</option>)}
            </select></label>
            {!!form.outcome && <label><span>{form.outcome === 'ติดต่อไม่ได้' ? 'ผู้ที่พยายามติดต่อ (ถ้าทราบ)' : 'ผู้ที่ติดต่อด้วย (ถ้าทราบ)'}</span><input value={form.person} maxLength={20000} onChange={event => set('person', event.target.value)} /></label>}
            {form.outcome === 'ขอไม่ให้ติดต่ออีก' && <div className="contact-warning" role="alert">ลูกค้าขอไม่ให้ติดต่ออีก ให้ส่งต่อคำขอตามกระบวนการธนาคาร การบันทึกนี้ยังไม่ได้บล็อกเบอร์หรือแก้ทะเบียนลูกค้า</div>}
            {!!form.outcome && <label><span>{full ? 'ข้อเท็จจริง *' : form.outcome === 'ไม่สนใจครั้งนี้' ? 'เหตุผล / หมายเหตุสั้น (ถ้ามี)' : 'หมายเหตุสั้น (ถ้ามี)'}</span>
              <textarea required={full} value={form.facts} maxLength={20000} onChange={event => set('facts', event.target.value)} placeholder="บันทึกเฉพาะสิ่งที่ทราบ ไม่จำเป็นต้องกรอกข้อความตัวอย่าง" />
              <small>บันทึกเฉพาะสิ่งที่ทราบ และระบุแหล่งที่มา</small>
            </label>}
            {callback && <>
              <label><span>วันเวลาติดต่อกลับ (เวลาไทย ถ้าทราบ)</span><input type="datetime-local" value={form.callbackAt} onInput={event => set('callbackAt', event.currentTarget.value)} onChange={event => set('callbackAt', event.target.value)} /></label>
              <label><span>ช่องทางติดต่อกลับที่ลูกค้าระบุ (ถ้ามี)</span><input value={form.callbackChannel} maxLength={20000} onChange={event => set('callbackChannel', event.target.value)} /></label>
            </>}
            {(full || callback) && <>
              <label><span>ข้อตกลงที่ยืนยันแล้ว</span><textarea value={form.agreements} maxLength={20000} onChange={event => set('agreements', event.target.value)} /><small>ใครจะทำอะไรเมื่อไร เฉพาะที่ยืนยันแล้ว</small></label>
              <label><span>ข้อเสนอแนะ / รอตรวจ</span><textarea value={form.suggestions} maxLength={20000} onChange={event => set('suggestions', event.target.value)} /><small>สิ่งที่ควรทำต่อ ไม่ใช่คำยืนยันของลูกค้า และไม่สร้างงานติดตามอัตโนมัติ</small></label>
              <label className="contact-check"><input type="checkbox" checked={form.callbackAllowed} onChange={event => set('callbackAllowed', event.target.checked)} /><span>ฉันระบุเองว่าลูกค้าอนุญาตให้ติดต่อกลับ (ไม่ใช่หลักฐานคำยินยอมของธนาคาร)</span></label>
            </>}
            {!!form.outcome && <>
              <button className="button" type="button" onClick={() => { setError(''); setDraft(draftContact(form)); }}>ช่วยร่างบันทึก</button>
              <small className="small-note">จัดข้อความจากช่องที่กรอกภายในแอป ไม่ส่งข้อมูลไปบริการ AI และไม่บันทึกอัตโนมัติ</small>
            </>}
            {draft && <section className="contact-draft" aria-label="ร่างสำหรับตรวจทาน">
              <h3>ร่างสำหรับตรวจทาน</h3>
              <h4>ข้อเท็จจริง</h4><p>{draft.facts || 'ยังไม่มีข้อความ'}</p>
              {(full || callback) && <><h4>ข้อตกลงที่ยืนยันแล้ว</h4><p>{draft.agreements || 'ยังไม่มีข้อความ'}</p><h4>ข้อเสนอแนะ / รอตรวจ</h4><p>{draft.suggestions || 'ยังไม่มีข้อความ'}</p></>}
              <button className="button" type="button" onClick={applyDraft}>นำร่างที่ตรวจแล้วไปใช้ในฟอร์ม</button>
              <button className="button" type="button" onClick={() => setDraft(null)}>ปิดร่าง</button>
            </section>}
            {full && <>
              <label className="contact-check"><input type="checkbox" checked={form.productPresented} onChange={event => set('productPresented', event.target.checked)} /><span>มีการนำเสนอผลิตภัณฑ์ในการติดต่อนี้</span></label>
              {form.productPresented && <label><span>รุ่น Sales Sheet ที่ใช้จริง *</span><input required value={form.salesSheet} maxLength={20000} onChange={event => set('salesSheet', event.target.value)} /></label>}
            </>}
            <details className="contact-before"><summary>ก่อนติดต่อ — ผล Call Verify และอ้างอิงหลักฐาน</summary>
              <p className="small-note">เจ้าหน้าที่เป็นผู้บันทึกผล ไม่ใช่การตรวจ Call Verify อัตโนมัติ</p>
              <label><span>ผล Call Verify ก่อนติดต่อ</span><select value={form.verify} onChange={event => set('verify', event.target.value)}>{options('ผล Call Verify ก่อนติดต่อ').map(value => <option key={value}>{value}</option>)}</select></label>
              <label><span>วันเวลาตรวจ Call Verify (เวลาไทย)</span><input type="datetime-local" value={form.verifiedAt} onInput={event => set('verifiedAt', event.currentTarget.value)} onChange={event => set('verifiedAt', event.target.value)} /></label>
              <label><span>อ้างอิงหลักฐานสิทธิติดต่อ</span><input value={form.evidence} maxLength={20000} onChange={event => set('evidence', event.target.value)} /></label>
            </details>
            {form.verify === 'สีแดง' && <p className="contact-warning" role="alert">ผลสีแดง: ห้ามติดต่อ แต่ยังบันทึกเหตุการณ์ที่เกิดขึ้นแล้วได้</p>}
            {['สีเหลือง', 'สีเขียว'].includes(form.verify) && <p className="small-note">ต้องมีความยินยอมและหลักฐานก่อนติดต่อ ผลสีนี้เพียงอย่างเดียวไม่ยืนยันสิทธิติดต่อ</p>}
            <details><summary>ตัวอย่างวิธีบันทึก — ข้อมูลสังเคราะห์</summary><p className="small-note">ตัวอย่างเท่านั้น ใช้ได้เมื่อผู้ใช้ระบุข้อเท็จจริงนั้นจริง และไม่ถูกนำไปบันทึกเอง</p><p>ข้อเท็จจริง: ผู้ดูแลบริษัท ทดสอบ เอสเอ็มอี จำกัด แจ้งว่าสนใจข้อมูลสินเชื่อเพื่อหมุนเวียนธุรกิจ ยังไม่ได้ระบุวงเงิน</p><p>ข้อตกลง: ลูกค้าขอรับรายละเอียดผลิตภัณฑ์ทางช่องทางที่ระบุ</p><p>ข้อเสนอแนะ / รอตรวจ: สอบถามวัตถุประสงค์เพิ่มเติม และตรวจความพร้อมของเอกสาร</p></details>
          </fieldset>
        </div>
        <div className="modal-foot contact-dialog-footer">
          <small>บันทึกเฉพาะประวัติใหม่ลง Google Sheets</small>
          <button className="button" type="button" disabled={saving} onClick={cancel}>ยกเลิก</button>
          <button className="button primary" type="submit" disabled={saving || disabled || needsLogin}>{saving ? 'กำลังบันทึก…' : uncertain ? 'ตรวจสอบ/ลองคำขอเดิมอีกครั้ง' : 'บันทึกประวัติ'}</button>
        </div>
      </form>
    </div>
  );
}
