import { useMemo, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import './customer-import.css';

type Row = { id: string; values: unknown[] };
type Draft = { draftId: string; values: unknown[]; source: string };
type Props = {
  headers: string[];
  existingRows: Row[];
  disabled: boolean;
  onClose: () => void;
  onSaved: (records: Row[], replayed: number, complete: boolean) => void;
};

const uuid = () => crypto.randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const aliases: Record<string, string[]> = {
  'ชื่อบริษัท': ['ชื่อบริษัท', 'บริษัท', 'company', 'company name'],
  'ชื่อเรียก / ชื่อร้าน': ['ชื่อเรียก / ชื่อร้าน', 'ชื่อร้าน', 'ชื่อเรียก', 'trade name'],
  'ประเภทนิติบุคคล': ['ประเภทนิติบุคคล', 'legal entity'],
  'ประเภทธุรกิจ': ['ประเภทธุรกิจ', 'business type'],
  'จังหวัดที่ประกอบธุรกิจ': ['จังหวัดที่ประกอบธุรกิจ', 'จังหวัด', 'province'],
  'ผู้ติดต่อหลัก': ['ผู้ติดต่อหลัก', 'ผู้ติดต่อ', 'contact person'],
  'ตำแหน่งผู้ติดต่อ': ['ตำแหน่งผู้ติดต่อ', 'ตำแหน่ง', 'position'],
  'เบอร์โทรศัพท์': ['เบอร์โทรศัพท์', 'โทรศัพท์', 'เบอร์โทร', 'phone'],
  'อีเมล / ช่องทางติดต่อ': ['อีเมล / ช่องทางติดต่อ', 'อีเมล', 'email'],
  'แหล่งที่มาของ Lead': ['แหล่งที่มาของ lead', 'แหล่งที่มาของ Lead', 'lead source'],
  'เลขทะเบียนนิติบุคคล (13 หลัก)': ['เลขทะเบียนนิติบุคคล (13 หลัก)', 'เลขทะเบียนนิติบุคคล', 'registration number'],
};
const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function csvRows(text: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let value = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(value); value = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value); value = '';
      if (row.some(cell => cell.trim())) rows.push([...row]);
      row.length = 0;
      continue;
    }
    value += char;
  }
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  if (quoted) throw new Error('ไฟล์ CSV มีเครื่องหมายคำพูดปิดไม่ครบ');
  return rows;
}

async function spreadsheetRows(file: File): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('ไม่พบ worksheet ในไฟล์ Excel');
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
}

async function pdfCompanyNames(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber), content = await page.getTextContent();
    const groups = new Map<number, Array<{ x: number; text: string }>>();
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str.trim() || !('transform' in raw)) continue;
      const y = Math.round(Number(raw.transform[5]) / 3) * 3;
      const values = groups.get(y) || [];
      values.push({ x: Number(raw.transform[4]), text: raw.str.trim() }); groups.set(y, values);
    }
    lines.push(...[...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').trim()).filter(Boolean));
  }
  const header = lines.findIndex(line => /^(ชื่อบริษัท|company name)$/i.test(line.trim()));
  if (header < 0) throw new Error('PDF ต้องมีบรรทัดหัวข้อ “ชื่อบริษัท” หรือ “Company Name”');
  const names = lines.slice(header + 1).map(line => line.trim()).filter(line => line && !/^หน้า\s*\d+|^page\s*\d+/i.test(line));
  if (!names.length) throw new Error('ไม่พบรายชื่อบริษัทหลังหัวข้อใน PDF');
  return names;
}

export default function CustomerImportDialog({ headers, existingRows, disabled, onClose, onSaved }: Props) {
  const indexes = useMemo(() => Object.fromEntries(headers.map((header, index) => [header, index])), [headers]);
  const blankValues = (leadSource = 'อื่น ๆ') => {
    const values = headers.map(() => null) as unknown[];
    values[indexes['วันที่เพิ่มลูกค้า']] = today();
    values[indexes['แหล่งที่มาของ Lead']] = leadSource;
    values[indexes['สถานะทะเบียน']] = 'ใช้งาน';
    values[indexes['วันที่ปรับปรุงล่าสุด']] = today();
    return values;
  };
  const [mode, setMode] = useState<'manual' | 'file'>('manual');
  const [leadSource, setLeadSource] = useState('อื่น ๆ');
  const [drafts, setDrafts] = useState<Draft[]>([{ draftId: uuid(), values: blankValues(), source: 'กรอกเอง' }]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requests = useRef(new Map<string, string>());
  const companyIndex = indexes['ชื่อบริษัท'], registrationIndex = indexes['เลขทะเบียนนิติบุคคล (13 หลัก)'];

  const setValue = (draftId: string, header: string, value: string) => setDrafts(current => current.map(draft =>
    draft.draftId === draftId ? { ...draft, values: draft.values.map((old, index) => index === indexes[header] ? (value || null) : old) } : draft
  ));
  const duplicateWarning = (draft: Draft) => {
    const registration = String(draft.values[registrationIndex] ?? '').trim();
    if (registration && existingRows.some(row => String(row.values[registrationIndex] ?? '').trim() === registration)) return 'เลขทะเบียนซ้ำกับข้อมูลเดิม';
    const name = String(draft.values[companyIndex] ?? '').trim().toLocaleLowerCase('th-TH');
    if (name && existingRows.some(row => String(row.values[companyIndex] ?? '').trim().toLocaleLowerCase('th-TH') === name)) return 'ชื่อบริษัทตรงกับข้อมูลเดิม โปรดตรวจรหัสลูกค้าก่อนยืนยัน';
    return '';
  };
  const rowsToDrafts = (rows: unknown[][], source: string) => {
    const companyAliases = aliases['ชื่อบริษัท'].map(normalizeHeader);
    const headerAt = rows.slice(0, 20).findIndex(row => row.some(cell => companyAliases.includes(normalizeHeader(cell))));
    if (headerAt < 0) throw new Error('ไม่พบหัวคอลัมน์ “ชื่อบริษัท” ในไฟล์');
    const sourceHeaders = rows[headerAt].map(normalizeHeader);
    const mapping = new Map<number, number>();
    for (const [target, names] of Object.entries(aliases)) {
      const sourceIndex = sourceHeaders.findIndex(value => names.map(normalizeHeader).includes(value));
      if (sourceIndex >= 0 && indexes[target] !== undefined) mapping.set(sourceIndex, indexes[target]);
    }
    const result = rows.slice(headerAt + 1).filter(row => row.some(cell => String(cell ?? '').trim())).map(row => {
      const values = blankValues(leadSource);
      for (const [sourceIndex, targetIndex] of mapping) {
        const value = String(row[sourceIndex] ?? '').trim();
        if (value) values[targetIndex] = value;
      }
      return { draftId: uuid(), values, source };
    }).filter(draft => String(draft.values[companyIndex] ?? '').trim());
    if (!result.length) throw new Error('ไม่พบแถวที่มีชื่อบริษัท');
    return result;
  };
  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setNotice('');
    if (file.size > 10 * 1024 * 1024) return setError('ไฟล์ต้องมีขนาดไม่เกิน 10 MB');
    setBusy(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let imported: Draft[];
      if (extension === 'csv') imported = rowsToDrafts(csvRows(await file.text()), file.name);
      else if (extension === 'xlsx' || extension === 'xls') imported = rowsToDrafts(await spreadsheetRows(file), file.name);
      else if (extension === 'pdf') imported = (await pdfCompanyNames(file)).map(name => {
        const values = blankValues(leadSource); values[companyIndex] = name;
        return { draftId: uuid(), values, source: file.name };
      });
      else throw new Error('รองรับเฉพาะ PDF, XLSX, XLS และ CSV');
      if (imported.length > 100) throw new Error('หนึ่งครั้งนำเข้าได้ไม่เกิน 100 รายชื่อ');
      setDrafts(imported); setNotice(`อ่านไฟล์แล้ว ${imported.length} รายชื่อ โปรดตรวจ preview ก่อนบันทึก`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'อ่านไฟล์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setError(''); setNotice('');
    const invalid = drafts.find(draft => !String(draft.values[companyIndex] ?? '').trim());
    if (invalid) return setError('ทุกรายการต้องมีชื่อบริษัท');
    const registrationDuplicate = drafts.find(draft => duplicateWarning(draft).startsWith('เลขทะเบียนซ้ำ'));
    if (registrationDuplicate) return setError('พบเลขทะเบียนซ้ำกับข้อมูลเดิม กรุณาลบหรือแก้รายการก่อนบันทึก');
    if (!drafts.length || !window.confirm(`ยืนยันเพิ่ม ${drafts.length} รายชื่อในทะเบียนลูกค้า?`)) return;
    setBusy(true);
    const saved: Row[] = []; let replayed = 0;
    try {
      for (const draft of drafts) {
        const requestId = requests.current.get(draft.draftId) || uuid();
        requests.current.set(draft.draftId, requestId);
        const response = await api.post('/api/records', { part: 'customers', requestId, values: draft.values });
        const result = response.data as { record?: Row; replayed?: boolean };
        if (!result.record) throw new Error('ไม่ได้รับผลยืนยันรายการที่บันทึก');
        saved.push(result.record); if (result.replayed) replayed += 1;
        setDrafts(current => current.filter(item => item.draftId !== draft.draftId));
      }
      onSaved(saved, replayed, true);
    } catch (cause) {
      if (saved.length) onSaved(saved, replayed, false);
      const failure = cause as { response?: { data?: { error?: string } } };
      setError(failure.response?.data?.error || (cause instanceof Error ? cause.message : 'บันทึกรายชื่อไม่สำเร็จ'));
      setBusy(false);
    }
  };

  const manual = drafts[0];
  const previewHeaders = ['ชื่อบริษัท', 'ชื่อเรียก / ชื่อร้าน', 'ประเภทธุรกิจ', 'จังหวัดที่ประกอบธุรกิจ', 'ผู้ติดต่อหลัก', 'เบอร์โทรศัพท์', 'แหล่งที่มาของ Lead'];
  return <div className="modal-backdrop customer-import-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal customer-import" role="dialog" aria-modal="true" aria-labelledby="customer-import-title">
      <header className="modal-head"><div><p className="eyebrow">CUSTOMER REGISTRY</p><h2 id="customer-import-title">เพิ่มรายชื่อ</h2><p className="small-note">ไฟล์ถูกอ่านเพื่อ preview ใน browser และไม่ได้อัปโหลดต้นฉบับไปเก็บ</p></div><button className="button" type="button" disabled={busy} onClick={onClose}>ปิด</button></header>
      <div className="customer-import-body">
        <div className="customer-import-tabs"><button type="button" className={mode === 'manual' ? 'selected' : ''} onClick={() => { setMode('manual'); setDrafts([{ draftId: uuid(), values: blankValues(leadSource), source: 'กรอกเอง' }]); }}>พิมพ์เพิ่ม</button><button type="button" className={mode === 'file' ? 'selected' : ''} onClick={() => { setMode('file'); setDrafts([]); }}>เพิ่มจากไฟล์</button></div>
        {error && <div className="error-banner" role="alert">{error}</div>}{notice && <div className="success-banner" role="status">{notice}</div>}
        {mode === 'manual' && manual && <div className="customer-import-fields">
          {['ชื่อบริษัท', 'ชื่อเรียก / ชื่อร้าน', 'ผู้ติดต่อหลัก', 'ตำแหน่งผู้ติดต่อ', 'เบอร์โทรศัพท์', 'อีเมล / ช่องทางติดต่อ', 'จังหวัดที่ประกอบธุรกิจ', 'เลขทะเบียนนิติบุคคล (13 หลัก)'].map(header => <label key={header}>{header}{header === 'ชื่อบริษัท' && ' *'}<input value={String(manual.values[indexes[header]] ?? '')} onChange={event => setValue(manual.draftId, header, event.target.value)} /></label>)}
          <label>ประเภทนิติบุคคล<select value={String(manual.values[indexes['ประเภทนิติบุคคล']] ?? '')} onChange={event => setValue(manual.draftId, 'ประเภทนิติบุคคล', event.target.value)}><option value="">ยังไม่ระบุ</option>{['บริษัทจำกัด','ห้างหุ้นส่วน','อื่น ๆ','ยังไม่ทราบ'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>ประเภทธุรกิจ<select value={String(manual.values[indexes['ประเภทธุรกิจ']] ?? '')} onChange={event => setValue(manual.draftId, 'ประเภทธุรกิจ', event.target.value)}><option value="">ยังไม่ระบุ</option>{['ผลิต','ค้าส่ง','ค้าปลีก','บริการ','อื่น ๆ','ยังไม่ทราบ'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>แหล่งที่มาของ Lead *<select value={String(manual.values[indexes['แหล่งที่มาของ Lead']] ?? '')} onChange={event => setValue(manual.draftId, 'แหล่งที่มาของ Lead', event.target.value)}>{['ลูกค้าติดต่อเอง','ธนาคารมอบหมาย','แนะนำต่อ','อื่น ๆ'].map(value => <option key={value}>{value}</option>)}</select></label>
          {duplicateWarning(manual) && <p className="customer-import-warning">{duplicateWarning(manual)}</p>}
        </div>}
        {mode === 'file' && <div>
          <div className="customer-import-file"><label>แหล่งที่มาของ Lead สำหรับช่องที่ไม่มีค่า<select value={leadSource} onChange={event => setLeadSource(event.target.value)}>{['ลูกค้าติดต่อเอง','ธนาคารมอบหมาย','แนะนำต่อ','อื่น ๆ'].map(value => <option key={value}>{value}</option>)}</select></label><label className="customer-file-button">เลือก PDF, Excel หรือ CSV<input type="file" accept=".pdf,.xlsx,.xls,.csv,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event => void chooseFile(event.target.files?.[0])} /></label></div>
          <p className="small-note">Excel/CSV: ต้องมีหัวคอลัมน์ “ชื่อบริษัท” รองรับชื่อหัวภาษาไทย/อังกฤษตามรายการที่กำหนด · PDF: ต้องมีบรรทัด “ชื่อบริษัท” แล้วหนึ่งบริษัทต่อบรรทัด ระบบจะไม่เดาข้อมูลช่องอื่น</p>
          {!!drafts.length && <div className="customer-import-table-wrap"><table><thead><tr>{previewHeaders.map(header => <th key={header}>{header}</th>)}<th>ตรวจซ้ำ</th><th>ลบ</th></tr></thead><tbody>{drafts.map(draft => <tr key={draft.draftId}>{previewHeaders.map(header => <td key={header}><input value={String(draft.values[indexes[header]] ?? '')} onChange={event => setValue(draft.draftId, header, event.target.value)} /></td>)}<td>{duplicateWarning(draft) || '—'}</td><td><button type="button" disabled={busy} onClick={() => setDrafts(current => current.filter(item => item.draftId !== draft.draftId))}>ลบ</button></td></tr>)}</tbody></table></div>}
        </div>}
      </div>
      <footer className="modal-foot"><small>{drafts.length} รายชื่อรอบันทึก · ระบบจะสร้างรหัสและวันที่ฝั่ง backend</small><button className="button" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button><button className="button primary" type="button" disabled={disabled || busy || !drafts.length} onClick={() => void save()}>{busy ? 'กำลังดำเนินการ…' : `ยืนยันเพิ่ม ${drafts.length} รายชื่อ`}</button></footer>
    </section>
  </div>;
}
