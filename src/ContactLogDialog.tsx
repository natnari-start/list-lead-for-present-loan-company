import { BUSINESS_QUESTIONS, DOCUMENT_STAGES, FUNDING_PLANS, QUALITY_CRITERIA, QUALITY_RESULTS } from './contact-business';
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
  const reviewedInputs = useRef<string | null>(null);
  const draftInputs = (value: ContactForm) => JSON.stringify({ outcome: value.outcome, callbackAllowed: value.callbackAllowed, callbackAt: value.callbackAt, callbackChannel: value.callbackChannel, fundingPlan: value.fundingPlan, questionsAsked: value.questionsAsked, answers: value.answers });
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
    if (['facts', 'agreements', 'suggestions'].includes(key)) reviewedInputs.current = null;
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
      if ((full || callback) && reviewedInputs.current && reviewedInputs.current !== draftInputs(form)) {
        setError('ข้อมูลสำหรับร่างเปลี่ยนแล้ว กรุณาช่วยร่างและตรวจใหม่ หรือแก้ข้อความบันทึกด้วยตนเองก่อนบันทึก');
        return;
      }
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
    reviewedInputs.current = draftInputs(form);
    setForm(current => ({ ...current, ...draft }));
    setDraft(null);
  }

  return (
    <div className="modal-backdrop contact-dialog-backdrop">
      <form ref={root} className="modal contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title" onSubmit={save}>
        <div className="modal-head">
          <div><h2 id="contact-dialog-title">เพิ่มรายการประวัติการติดต่อ</h2><p className="small-note">ฟอร์มเสนอของ CRM ไม่ใช่แบบฟอร์มทางการธนาคาร · ไม่ใช่ไฟล์เสียง ผลสินเชื่อ หรือหลักฐานคำยินยอม</p></div>
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
            {form.outcome === 'ขอไม่ให้ติดต่ออีก' && <div className="contact-warning" role="alert">ลูกค้าขอไม่ให้ติดต่ออีก ห้ามสร้างงานขายติดตาม ให้ตรวจช่องทาง/บทบาทและส่งต่อตาม Selling Guideline ผ่าน TM ตามกระบวนการที่เกี่ยวข้อง หากไม่แน่ใจให้ยืนยันขั้นตอนกับ TM ก่อน การบันทึกนี้ยังไม่ได้บล็อกเบอร์หรือแก้ทะเบียนลูกค้า</div>}
            {(full || callback) && <label><span>แผนใช้เงินตามที่ลูกค้าแจ้ง (ถ้าทราบ)</span>
              <select value={form.fundingPlan} onChange={event => set('fundingPlan', event.target.value)}>
                <option value="">— ยังไม่ระบุ —</option>{FUNDING_PLANS.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>}
            {full && <>
              <label className="contact-check"><input type="checkbox" checked={form.questionsAsked} onChange={event => set('questionsAsked', event.target.checked)} /><span>ได้สอบถามข้อมูลธุรกิจแล้ว — เปิดคำถาม 5 ข้อ (ไม่บังคับ)</span></label>
              {form.questionsAsked && <section aria-label="คำตอบธุรกิจ 5 ข้อ" className="contact-question-group">
                <p className="small-note">กรอกเฉพาะที่ลูกค้าแจ้ง ระบุหน่วยและแหล่งที่มาเมื่อมี ช่องว่างไม่ถือว่าไม่มีสินเชื่อหรือไม่มีรายได้</p>
                {BUSINESS_QUESTIONS.map(([key, label]) => <label key={key}><span>{label}</span>
                  <input value={form.answers[key]} maxLength={2000} onChange={event => set('answers', { ...form.answers, [key]: event.target.value })} />
                </label>)}
              </section>}
              <details><summary>เกณฑ์คุณภาพ 8 ข้อ — ความเห็นพนักงาน (ไม่บังคับ)</summary>
                <p className="small-note">ไม่ใช่เกณฑ์อนุมัติธนาคาร ไม่มีการคำนวณหรือตัดสินอัตโนมัติ และไม่บล็อกการบันทึก</p>
                <p className="contact-warning">อายุธุรกิจในคู่มือขัดกัน: เกณฑ์ระบุ 8 ปีขึ้นไป แต่ข้อความจำระบุ 6 ปีขึ้นไป ให้บันทึกสิ่งที่ตรวจพบ แอปไม่เลือกเกณฑ์แทน</p>
                {QUALITY_CRITERIA.map(([key, label]) => <label key={key}><span>{label}</span>
                  <select value={form.quality[key]} onChange={event => set('quality', { ...form.quality, [key]: event.target.value })}>
                    {QUALITY_RESULTS.map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>)}
                <label><span>สิ่งที่ตรวจพบ / แหล่งที่มาเกี่ยวกับเกณฑ์</span><textarea value={form.qualityNote} maxLength={2000} onChange={event => set('qualityNote', event.target.value)} /></label>
              </details>
              <details><summary>ขั้นเอกสารที่ยืนยันแล้ว (ไม่บังคับ)</summary>
                <label><span>ขั้นเอกสาร</span><select value={form.documentStage} onChange={event => set('documentStage', event.target.value)}>
                  <option value="">— ยังไม่ระบุ —</option>{DOCUMENT_STAGES.map(value => <option key={value}>{value}</option>)}
                </select></label>
                <p className="small-note">คำแนะนำจากคู่มือ Team.Su: Prescreen ใช้เอกสารกรรมการและเอกสารกิจการ; ขั้นถัดไปอาจนัดถ่ายรูปและสัมภาษณ์ หรือขอ Full Doc ตามที่ยืนยัน ไม่มีการอัปโหลด แก้แท็บเอกสาร หรือเปลี่ยนสถานะเคสจากตัวเลือกนี้</p>
              </details>
            </>}
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
              <label><span>ร่างข้อเท็จจริง — แก้ไขก่อนใช้</span><textarea maxLength={20000} value={draft.facts} onChange={event => setDraft({ ...draft, facts: event.target.value })} /></label>
              {(full || callback) && <><label><span>ร่างข้อตกลงที่ยืนยันแล้ว</span><textarea maxLength={20000} value={draft.agreements} onChange={event => setDraft({ ...draft, agreements: event.target.value })} /></label><label><span>ร่างข้อเสนอแนะ / รอตรวจ</span><textarea maxLength={20000} value={draft.suggestions} onChange={event => setDraft({ ...draft, suggestions: event.target.value })} /></label></>}
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
            {form.verify === 'สีแดง' && <p className="contact-warning" role="alert">ผลสีแดง: ห้ามติดต่อหรือสร้างงานขายติดตาม แต่ยังบันทึกเหตุการณ์ที่เกิดขึ้นแล้วได้ ไม่ใช่สิทธิให้ติดต่อครั้งต่อไป</p>}
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

