import { useEffect, useMemo, useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import { schemas } from './schema';
import { getCompanySearchLink } from './company-search';
import ContactLogDialog from './ContactLogDialog';
import CustomerImportDialog from './CustomerImportDialog';
import {
  CONTACT_SEARCH_HEADER,
  CONTACT_SEARCH_LABEL,
  contactSearchUpdate,
  isContactSearchChecked,
} from './contact-search-status';

type Part = 'customers' | 'cases' | 'contacts' | 'tasks' | 'documents';
type Row = { id: string; values: unknown[] };
type Data = Record<Part, Row[]>;
type Spec = {
  key: Part;
  sheetName: string;
  headers: string[];
  required: number[];
  options: Record<string, string[]>;
  dates: number[];
  numbers: number[];
  longText?: number[];
};
type User = { email?: string; name?: string };
const specs = schemas as unknown as Spec[];
const names: Record<Part, string> = {
  customers: 'ทะเบียนลูกค้า',
  cases: 'เคสสินเชื่อ',
  contacts: 'ประวัติการติดต่อ',
  tasks: 'งานติดตาม',
  documents: 'รายการเอกสาร',
};
const tabOrder: Part[] = ['customers', 'contacts', 'tasks', 'cases', 'documents'];
const columns: Record<Part, number[]> = {
  customers: [0, 2, 5, 7, 14, 19],
  cases: [0, 1, 3, 5, 7, 12, 13],
  contacts: [0, 1, 2, 3, 4, 6],
  tasks: [0, 1, 2, 3, 5, 7],
  documents: [0, 1, 2, 4, 5],
};
const blankData = (): Data => ({
  customers: [],
  cases: [],
  contacts: [],
  tasks: [],
  documents: [],
});
const isBlank = (value: unknown) =>
  value === null || value === undefined || String(value).trim() === '';
const localDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const money = (value: unknown) =>
  `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Number(value) || 0)} บาท`;
const escCsv = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const classifyTask = (row: unknown[], today: string) => {
  if (!row[0]) return '';
  if (row[7] === 'เสร็จแล้ว' || row[7] === 'ยกเลิก') return String(row[7]);
  if (isBlank(row[5])) return 'ยังไม่กำหนดวัน';
  const due = String(row[5]).slice(0, 10);
  return due < today ? 'เกินกำหนด' : due === today ? 'วันนี้' : 'รอถึงกำหนด';
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [part, setPart] = useState<Part>('customers');
  const [data, setData] = useState<Data>(blankData());
  const [query, setQuery] = useState('');
  const [record, setRecord] = useState<Row | null>(null);
  const [contactContext, setContactContext] = useState<{ customerId?: string; caseId?: string } | null>(null);
  const [customerImportOpen, setCustomerImportOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Row | null>(null);
  const [values, setValues] = useState<unknown[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingContactSearch, setPendingContactSearch] = useState<Record<string, boolean>>({});
  const contactSearchLocks = useRef(new Set<string>());
  const [sheetStatus, setSheetStatus] = useState<
    'checking' | 'connected' | 'mismatch' | 'error'
  >('checking');
  const [sheetMessage, setSheetMessage] = useState('');

  useEffect(() => {
    if (!selectedCustomer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCustomer(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedCustomer]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/data');
      setData(response.data as Data);
    } catch (cause) {
      const responseMessage = (cause as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(responseMessage || (cause instanceof Error ? cause.message : 'โหลดข้อมูลไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    auth
      .getUser()
      .then(async current => {
        if (!current) return;
        try {
          await api.get('/api/session');
          setUser(current);
        } catch {
          await auth.signOut();
          setError('ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาตรวจการตั้งค่าผู้ดูแล');
        }
      })
      .catch(() => setError('เข้าสู่ระบบไม่สำเร็จ'));
  }, []);
  useEffect(() => {
    if (!user) return;
    void load();
    api
      .get('/api/integration/google-sheets/status')
      .then(response => {
        const status = response.data as {
          connected?: boolean;
          errorCode?: string;
          errorMessage?: string;
          checkedSheets?: Array<{ headersMatch: boolean }>;
        };
        const headersMismatch = status.checkedSheets?.some(sheet => !sheet.headersMatch);
        setSheetStatus(
          status.connected
            ? 'connected'
            : status.errorCode
              ? 'error'
              : headersMismatch
                ? 'mismatch'
                : 'error'
        );
        setSheetMessage(status.errorMessage || '');
      })
      .catch(() => {
        setSheetStatus('error');
        setSheetMessage('ตรวจสอบสถานะ Google Sheets ไม่สำเร็จ');
      });
  }, [user]);

  const spec = specs.find(item => item.key === part)!;
  const customerSpec = specs.find(item => item.key === 'customers')!;
  const companyNameIndex = customerSpec.headers.indexOf('ชื่อบริษัท');
  const contactSearchIndex = customerSpec.headers.indexOf(CONTACT_SEARCH_HEADER);
  const companySearch =
    part === 'customers' ? getCompanySearchLink(spec.headers, values) : null;
  const visibleRows = useMemo(
    () =>
      (data[part] || []).filter(
        row =>
          !query ||
          row.values.some(v =>
            String(v ?? '')
              .toLowerCase()
              .includes(query.toLowerCase())
          )
      ),
    [data, part, query]
  );
  const today = localDate();
  const customerCount = data.customers.filter(
    row => row.values[19] !== 'เก็บถาวร'
  ).length;
  const requested = data.cases.reduce(
    (sum, row) => sum + (Number(row.values[5]) || 0),
    0
  );
  const approved = data.cases.reduce(
    (sum, row) => sum + (Number(row.values[12]) || 0),
    0
  );
  const disbursed = data.cases.reduce(
    (sum, row) => sum + (Number(row.values[13]) || 0),
    0
  );
  const dueToday = data.tasks.filter(
    row => classifyTask(row.values, today) === 'วันนี้'
  ).length;
  const overdue = data.tasks.filter(
    row => classifyTask(row.values, today) === 'เกินกำหนด'
  ).length;
  const casesWithoutTask = data.cases.filter(
    loan =>
      !data.tasks.some(
        task =>
          task.values[2] === loan.values[0] &&
          !['เสร็จแล้ว', 'ยกเลิก'].includes(String(task.values[7]))
      )
  ).length;

  const beginContact = (context: { customerId?: string; caseId?: string } = {}) => {
    setSelectedCustomer(null);
    setRecord(null);
    setPart('contacts');
    setQuery('');
    setContactContext(context);
    setError('');
    setNotice('');
  };
  const beginAdd = () => {
    const initial = spec.headers.map((_, index) => {
      if (index === 0)
        return `${part.slice(0, -1).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      if (part === 'customers' && index === 19) return 'ใช้งาน';
      if (
        (spec.dates || []).includes(index) &&
        (spec.required || []).includes(index)
      )
        return localDate();
      return null;
    });
    setRecord(null);
    setValues(initial);
    setError('');
  };
  const beginEdit = (row: Row) => {
    setRecord(row);
    setValues([...row.values]);
    setError('');
  };
  const setField = (index: number, value: string) =>
    setValues(current =>
      current.map((old, i) =>
        i === index ? (value === '' ? null : value) : old
      )
    );
  const relation = (index: number): 'customer' | 'case' | null => {
    if (
      (part === 'cases' || part === 'contacts' || part === 'tasks') &&
      index === 1
    )
      return 'customer';
    if (
      ((part === 'contacts' || part === 'tasks') && index === 2) ||
      (part === 'documents' && index === 1)
    )
      return 'case';
    return null;
  };
  const makeFormControl = (index: number) => {
    const value =
      values[index] === null || values[index] === undefined
        ? ''
        : String(values[index]);
    const relationType = relation(index);
    if (index === 0 || (part === 'tasks' && index === 9)) return <input value={value} readOnly />;
    if (part === 'customers' && spec.headers[index] === CONTACT_SEARCH_HEADER) {
      return (
        <input
          type="checkbox"
          className="contact-search-input"
          checked={isContactSearchChecked(values[index])}
          onChange={event => setField(index, event.target.checked ? 'TRUE' : 'FALSE')}
        />
      );
    }
    if (relationType === 'customer')
      return (
        <select
          value={value}
          onChange={event => {
            setField(index, event.target.value);
            if (part !== 'cases' && index === 1) setField(2, '');
          }}
        >
          <option value="">— เลือกลูกค้า —</option>
          {data.customers.map(item => (
            <option key={item.id} value={String(item.values[0])}>
              {String(item.values[2] || item.id)} ({item.id})
            </option>
          ))}
        </select>
      );
    if (relationType === 'case') {
      const customerId = part === 'documents' ? null : values[1];
      const cases = data.cases.filter(
        item =>
          customerId === null || String(item.values[1]) === String(customerId)
      );
      return (
        <select
          value={value}
          onChange={event => setField(index, event.target.value)}
        >
          <option value="">— ไม่ระบุเคส —</option>
          {cases.map(item => (
            <option key={item.id} value={String(item.values[0])}>
              {item.id} · {customerName(data, item.values[1])}
            </option>
          ))}
        </select>
      );
    }
    const choices = spec.options?.[String(index)];
    if (choices)
      return (
        <select
          value={value}
          onChange={event => setField(index, event.target.value)}
        >
          <option value="">— ยังไม่ระบุ —</option>
          {choices.map(choice => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
          {value && !choices.includes(value) && <option value={value}>{value} (ค่าเดิม)</option>}
        </select>
      );
    if (spec.numbers?.includes(index)) {
      if (value && !Number.isFinite(Number(value)))
        return <input value={value} onChange={event => setField(index, event.target.value)} />;
      return (
        <input type="number" step="any" value={value} placeholder="กรอกตัวเลข"
          onChange={event => setField(index, event.target.value)} />
      );
    }
    if (spec.dates?.includes(index)) {
      const dateTime = part === 'contacts' && (index === 3 || index === 12);
      const validDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(value);
      if (value && !validDate)
        return <input value={value} onChange={event => setField(index, event.target.value)} />;
      return (
        <input type={dateTime ? 'datetime-local' : 'date'} value={value}
          onChange={event => setField(index, event.target.value)} />
      );
    }
    if (spec.longText?.includes(index) || spec.headers[index].length > 38)
      return (
        <textarea
          value={value}
          placeholder={`กรอก${spec.headers[index]}`}
          onChange={event => setField(index, event.target.value)}
        />
      );
    return (
      <input
        value={value}
        readOnly={index === 0 && !!record}
        placeholder={`กรอก${spec.headers[index]}`}
        onChange={event => setField(index, event.target.value)}
      />
    );
  };

  async function toggleContactSearch(row: Row, checked: boolean) {
    if (loading || sheetStatus !== 'connected' || contactSearchLocks.current.has(row.id)) return;
    contactSearchLocks.current.add(row.id);
    setPendingContactSearch(current => ({ ...current, [row.id]: checked }));
    setError('');
    setNotice('');
    try {
      const response = await api.put(
        `/api/records/customers/${encodeURIComponent(row.id)}`,
        contactSearchUpdate(customerSpec.headers, row, checked)
      );
      const saved = (response.data.data as Data).customers.find(item => item.id === row.id);
      if (!saved) throw new Error('ไม่พบผลยืนยันการบันทึก กรุณารีเฟรช');
      setData(current => ({
        ...current,
        customers: current.customers.map(item => item.id === row.id ? saved : item),
      }));
      setSelectedCustomer(current => current?.id === row.id ? saved : current);
      setNotice(checked ? 'บันทึกผลค้นหา: ไม่พบข้อมูลช่องทางติดต่อแล้ว' : 'ยกเลิกเครื่องหมายผลค้นหาแล้ว');
    } catch (cause) {
      const failure = cause as { response?: { status?: number; data?: { error?: string } } };
      const status = failure.response?.status;
      const message = failure.response?.data?.error ||
        (cause instanceof Error ? cause.message : 'บันทึกผลค้นหาไม่สำเร็จ');
      if (status === 409) await load();
      if (status === 401 || status === 403) {
        setSheetStatus('error');
        setSheetMessage('ไม่มีสิทธิ์บันทึก กรุณาตรวจสิทธิ์และโหลดหน้าใหม่');
      }
      setError(message);
    } finally {
      contactSearchLocks.current.delete(row.id);
      setPendingContactSearch(current => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!record) return;
    if (!window.confirm('ยืนยันบันทึกการแก้ไขลง Google Sheets จริง?')) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const normalized = values.map((value, index) =>
        isBlank(value)
          ? null
          : spec.numbers.includes(index)
            ? Number(value)
            : String(value)
      );
      const response = await api.put(
        `/api/records/${part}/${encodeURIComponent(record.id)}`,
        { values: normalized, expectedValues: record.values }
      );
      setData(response.data.data as Data);
      setRecord(null);
      setValues([]);
      setNotice('บันทึกการแก้ไขลง Google Sheets แล้ว');
    } catch (cause) {
      const responseMessage = (cause as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(responseMessage || (cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }

  async function archive(row: Row) {
    if (
      !window.confirm('เก็บถาวรบริษัทนี้? เคสและประวัติที่เชื่อมโยงจะยังอยู่')
    )
      return;
    const updated = [...row.values];
    updated[19] = 'เก็บถาวร';
    updated[22] = today;
    try {
      const response = await api.put(
        `/api/records/customers/${encodeURIComponent(row.id)}`,
        { values: updated }
      );
      setData(response.data.data as Data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เก็บถาวรไม่สำเร็จ');
    }
  }

  async function remove(row: Row) {
    if (!window.confirm('ยืนยันลบรายการนี้? รายการที่ลบจะกู้คืนไม่ได้')) return;
    try {
      const response = await api.delete(
        `/api/records/${part}/${encodeURIComponent(row.id)}`
      );
      setData(response.data.data as Data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ลบไม่สำเร็จ');
    }
  }

  function exportCsv() {
    const lines = [
      spec.headers.map(escCsv).join(','),
      ...visibleRows.map(row => row.values.map(escCsv).join(',')),
    ];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob(['\uFEFF', lines.join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      })
    );
    link.download = `${names[part]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function signIn() {
    setLoading(true);
    setError('');
    try {
      const result = await auth.signIn({ scope: 'openid email profile offline_access' });
      await api.get('/api/session');
      setUser(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  if (!user)
    return (
      <main className="login">
        <section className="login-card">
          <div className="brand-mark">SF</div>
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>SME Freedom Desk</h1>
          <p className="muted">ระบบติดตามลูกค้าและงานสินเชื่อ · Google Sheets</p>
          <button
            className="button primary large"
            onClick={signIn}
            disabled={loading}
          >
            เข้าสู่ระบบด้วย Google
          </button>
          {error && <p className="error">{error}</p>}
          <p className="small-note">
            อนุญาตเฉพาะบัญชีผู้ดูแล ข้อมูลจะแสดงเมื่อเชื่อม Google Sheets สำเร็จ
          </p>
        </section>
      </main>
    );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            SME Freedom <span>DESK</span>
          </div>
          <small>Google Sheets · ผู้ดูแล · {user.name || user.email}</small>
        </div>
        <button
          className="button ghost"
          onClick={() => {
            auth.signOut();
            setUser(null);
          }}
        >
          ออกจากระบบ
        </button>
      </header>
      <main className="main">
        <section className="heading">
          <div>
            <p className="eyebrow">CUSTOMER RELATIONSHIP</p>
            <h1>ติดตามลูกค้าและงานสินเชื่อ</h1>
            <p className="muted">
              ข้อมูลจาก Google Sheets ต้นฉบับ · การบันทึกจะเปลี่ยนข้อมูลในชีตจริง
            </p>
            <p className="muted">
              Google Sheets:{' '}
              {sheetStatus === 'checking'
                ? 'กำลังตรวจสอบ Google Sheets'
                : sheetStatus === 'connected'
                  ? 'เชื่อมต่อชีตและตรวจหัวตารางแล้ว'
                  : sheetStatus === 'mismatch'
                    ? 'หัวตารางไม่ตรง ระบบหยุดโหลดข้อมูล'
                    : 'เชื่อมต่อไม่สำเร็จ ระบบไม่ใช้ข้อมูล Sandbox'}
              {sheetMessage && sheetStatus !== 'connected' ? ' · ' + sheetMessage : ''}
              {sheetStatus === 'connected' ? ' · แก้ไขรายการเดิมและเพิ่มประวัติการติดต่อได้' : ' · ปิดการแก้ไขจนกว่าจะเชื่อมต่อสำเร็จ'}
            </p>
          </div>
        </section>
        <section className="stats">
          <Stat label="ลูกค้าใช้งาน" value={customerCount} />
          <Stat
            label="งานวันนี้ / เกินกำหนด"
            value={`${dueToday} / ${overdue}`}
          />
          <Stat label="วงเงินที่ขอ" value={money(requested)} />
          <Stat
            label="อนุมัติ / เบิกจ่าย"
            value={`${money(approved)} / ${money(disbursed)}`}
          />
        </section>
        <section className="status-line">
          <b>เคสที่ยังไม่มีงานถัดไป</b>
          <span>{casesWithoutTask}</span>
          <small>จำนวนเคสแยกจากจำนวนลูกค้า · นับลูกค้าจากรหัสไม่ซ้ำ</small>
        </section>
        <nav className="tabs">
          {tabOrder.map(key => (
            <button
              className={part === key ? 'selected' : ''}
              key={key}
              onClick={() => {
                setPart(key);
                setQuery('');
                setRecord(null);
                setContactContext(null);
                setCustomerImportOpen(false);
              }}
            >
              {names[key]} <span>{data[key]?.length || 0}</span>
            </button>
          ))}
        </nav>
        <section className="section-heading">
          <div>
            <h2>{names[part]}</h2>
            <small>{data[part]?.length || 0} รายการ</small>
          </div>
          <div className="actions">
            <button className="button" onClick={exportCsv}>
              Export CSV
            </button>
            <button
              className="button"
              onClick={() => void load()}
              disabled={loading}
            >
              รีเฟรช
            </button>
            {part === 'customers' ? (
              <button className="button primary" type="button" onClick={() => setCustomerImportOpen(true)} disabled={loading || sheetStatus !== 'connected'}>เพิ่มรายชื่อ</button>
            ) : part === 'contacts' ? (
              <button className="button primary" data-add-contact type="button" onClick={() => beginContact()} disabled={loading || sheetStatus !== 'connected'}>เพิ่มรายการ</button>
            ) : <small className="small-note">เพิ่มประวัติการติดต่อได้จากแท็บประวัติการติดต่อ</small>}
          </div>
        </section>
        <input
          className="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={`ค้นหา${names[part]}`}
        />
        {error && (
          <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}>ปิด</button></div>
        )}
        {notice && (
          <div className="success-banner" role="status">{notice}<button onClick={() => setNotice('')}>ปิด</button></div>
        )}
        {customerImportOpen && part === 'customers' && <CustomerImportDialog
          headers={customerSpec.headers}
          existingRows={data.customers}
          disabled={loading || sheetStatus !== 'connected'}
          onClose={() => setCustomerImportOpen(false)}
          onSaved={(saved, replayed, complete) => {
            setData(current => ({
              ...current,
              customers: [...current.customers.filter(row => !saved.some(item => item.id === row.id)), ...saved],
            }));
            if (complete) setCustomerImportOpen(false);
            setNotice(complete
              ? `บันทึก ${saved.length} รายชื่อแล้ว${replayed ? ` · ยืนยันคำขอเดิม ${replayed} รายการโดยไม่สร้างซ้ำ` : ''}`
              : `บันทึกสำเร็จ ${saved.length} รายชื่อ ส่วนที่เหลือยังอยู่ในหน้าตรวจสอบ`);
          }}
        />}
        {contactContext && <ContactLogDialog
          customers={data.customers} cases={data.cases} context={contactContext}
          disabled={loading || sheetStatus !== 'connected'}
          onClose={() => setContactContext(null)}
          onSaved={(saved, replayed) => {
            setData(current => ({ ...current, contacts: [...current.contacts.filter(row => row.id !== saved.id), saved] }));
            setContactContext(null);
            setNotice(replayed ? 'ยืนยันรายการเดิมใน Google Sheets แล้ว ไม่สร้างรายการซ้ำ' : 'บันทึกประวัติใหม่ลง Google Sheets แล้ว');
          }}
        />}
        {selectedCustomer && part === 'customers' && (
          <div
            className="modal-backdrop"
            onClick={event => {
              if (event.target === event.currentTarget) setSelectedCustomer(null);
            }}
          >
            <section
              className="modal details-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="customer-details-title"
            >
              <div className="modal-head">
                <div className="details-heading">
                  <p className="eyebrow">COMPANY PROFILE</p>
                  <h2 id="customer-details-title">
                    {String(selectedCustomer.values[2] || 'ข้อมูลบริษัท')}
                  </h2>
                  <p className="small-note details-meta">
                    รหัสลูกค้า: {String(selectedCustomer.values[0] || '—')}
                  </p>
                </div>
                <button
                  className="button"
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  aria-label="ปิดข้อมูลบริษัท"
                >
                  ปิด
                </button>
              </div>
              <p className="small-note details-note">
                แสดงข้อมูลทั้งหมดจากทะเบียนลูกค้า · โหมดอ่านอย่างเดียว
              </p>
              <div className="details-grid">
                {customerSpec.headers.map((header, index) => {
                  const value = selectedCustomer.values[index];
                  return (
                    <div className="detail-field" key={header}>
                      <span>{header}</span>
                      <strong>{header === CONTACT_SEARCH_HEADER
                        ? displayValue('customers', index, value, data)
                        : isBlank(value) ? '—' : String(value)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="modal-foot">
                <button className="button primary" type="button" disabled={loading || sheetStatus !== 'connected'} onClick={() => beginContact({ customerId: selectedCustomer.id })}>เพิ่มประวัติการติดต่อ</button>
                <button
                  className="button"
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </section>
          </div>
        )}
        {record && (
          <div className="modal-backdrop">
            <form className="modal edit-modal" onSubmit={save}>
              <div className="modal-head">
                <div className="edit-heading">
                  <h2>แก้ไข{names[part]}</h2>
                  {companySearch && (
                    <a
                      className="company-search-link"
                      href={companySearch.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`ค้นหา ${companySearch.name} ใน Google (เปิดแท็บใหม่)`}
                    >
                      <span>{companySearch.name}</span>
                      <small>ค้นหาใน Google · เปิดแท็บใหม่ ↗</small>
                    </a>
                  )}
                </div>
                <button className="button" type="button" onClick={() => setRecord(null)}>ปิด</button>
              </div>
              <p className="small-note">การบันทึกจะเปลี่ยนข้อมูลจริงใน Google Sheets · รหัสรายการและช่องคำนวณอัตโนมัติแก้ไขไม่ได้</p>
              {error && <div className="error-banner">{error}<button type="button" onClick={() => setError('')}>ปิด</button></div>}
              <div className="form-grid">
                {spec.headers.map((header, index) => part === 'contacts' && header === 'รายละเอียดธุรกิจจากการติดต่อ (JSON)' ? null : (
                  <label className={spec.longText?.includes(index) || header.length > 38 ? 'wide' : ''} key={header}>
                    <span>{header}{spec.required.includes(index) ? <b className="required"> *</b> : ''}</span>
                    {makeFormControl(index)}
                  </label>
                ))}
              </div>
              <div className="modal-foot">
                <button className="button" type="button" onClick={() => setRecord(null)}>ยกเลิก</button>
                <button className="button primary" type="submit" disabled={loading || sheetStatus !== 'connected'}>
                  {loading ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns[part].map(index => (<th key={index}>{spec.headers[index]}</th>))}
                {sheetStatus === 'connected' && <th>การดำเนินการ</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr key={row.id}>
                  {columns[part].map(index => (
                    <td key={index}>
                      {part === 'customers' && index === companyNameIndex ? (
                        <div className="company-registry-cell">
                          <button
                          type="button"
                          className="company-name-button"
                          onClick={() => setSelectedCustomer(row)}
                          aria-haspopup="dialog"
                          aria-label={`เปิดข้อมูลบริษัท ${String(row.values[companyNameIndex] || 'ไม่ระบุชื่อบริษัท')}`}
                        >
                          {displayValue(part, index, row.values[index], data)}
                          </button>
                          <label className="contact-search-control">
                            <input
                              type="checkbox"
                              checked={pendingContactSearch[row.id] ?? isContactSearchChecked(row.values[contactSearchIndex])}
                              disabled={loading || sheetStatus !== 'connected' || contactSearchLocks.current.has(row.id)}
                              aria-label={`${CONTACT_SEARCH_LABEL} · ${row.id}`}
                              aria-describedby={`contact-search-state-${encodeURIComponent(row.id)}`}
                              onChange={event => void toggleContactSearch(row, event.target.checked)}
                            />
                            <span>{CONTACT_SEARCH_LABEL}</span>
                          </label>
                          <small
                            id={`contact-search-state-${encodeURIComponent(row.id)}`}
                            className="contact-search-state"
                            role="status"
                          >
                            {contactSearchLocks.current.has(row.id)
                              ? 'กำลังบันทึก…'
                              : sheetStatus !== 'connected'
                                ? 'ปิดการแก้ไข: ' + (sheetMessage || 'Google Sheets ยังไม่พร้อม')
                                : 'บันทึกผลที่คุณตรวจแล้ว · เอาติ๊กออกเพื่อยกเลิกเครื่องหมาย'}
                          </small>
                        </div>
                      ) : (
                        displayValue(part, index, row.values[index], data)
                      )}
                    </td>
                  ))}
                  {sheetStatus === 'connected' && <td className="row-actions"><button type="button" onClick={() => beginEdit(row)}>แก้ไข</button>{part === 'cases' && <button type="button" onClick={() => beginContact({ caseId: row.id, customerId: String(row.values[spec.headers.indexOf('รหัสลูกค้า')]) })}>บันทึกการติดต่อ</button>}</td>}
                </tr>
              ))}
              {!visibleRows.length && (
                <tr>
                  <td colSpan={columns[part].length + (sheetStatus === 'connected' ? 1 : 0)} className="empty">
                    {loading ? 'กำลังโหลด…' : 'ไม่พบรายการ'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

    </div>
  );
}

function customerName(data: Data, id: unknown) {
  return (
    data.customers.find(row => String(row.values[0]) === String(id))
      ?.values[2] ||
    id ||
    ''
  );
}
function displayValue(part: Part, index: number, value: unknown, data: Data) {
  if (part === 'customers' && specs.find(item => item.key === part)?.headers[index] === CONTACT_SEARCH_HEADER) {
    return isContactSearchChecked(value) ? CONTACT_SEARCH_LABEL : 'ยังไม่ติ๊ก';
  }
  if (value === null || value === undefined) return '—';
  if (
    (part === 'cases' || part === 'contacts' || part === 'tasks') &&
    index === 1
  )
    return customerName(data, value);
  if ((part === 'contacts' || part === 'tasks') && index === 2 && value)
    return String(value);
  return String(value);
}
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}
