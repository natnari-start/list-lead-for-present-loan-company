import { useEffect, useMemo, useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import {
  Users, Phone, CalendarCheck, BriefcaseBusiness, Files, RefreshCw, Search,
  Plus, ChevronLeft, ChevronRight, SlidersHorizontal, Building2, CalendarDays,
  Mail, MapPin, MapPinned, Banknote, Link2, ShieldCheck, FileText, Globe,
  MessageCircle, CircleCheck, Hash,
} from 'lucide-react';
import './usability.css';
import { schemas } from './schema';
import { getCompanySearchLink } from './company-search';
import ContactLogDialog from './ContactLogDialog';
import ContactHistoryView from './ContactHistoryView';
import { filterContactCompanies, groupContactHistory } from './contact-history';
import CustomerImportDialog from './CustomerImportDialog';
import DocumentChecklist from './DocumentChecklist';
import CaseFollowUpWorkbench from './CaseFollowUpWorkbench';
import { buildReadModel } from './crm-read-model';
import { caseSummary } from './loan-case-view';
import './document-checklist.css';
import FinancialEditorDialog from './FinancialEditorDialog';
import FinancialScreeningCell, { FinancialHistory, LatestFinancialCell, RegistryScreeningCell } from './FinancialScreeningCell';
import { assessFinancials, type OverallStatus } from './financial-screening';
import {
  customerBusinessType, filterCustomerRegistryRows, prioritizeUncontactedCustomers, registryBusinessTypeOptions, registrySortOptions, sortCustomerRegistryRows,
  type RegistrySort, type RegistrySortKey,
} from './customer-registry';
import './registry-sort.css';
import {
  CONTACT_SEARCH_HEADER,
  CONTACT_SEARCH_LABEL,
  isContactSearchChecked,
} from './contact-search-status';

type Part = 'customers' | 'cases' | 'contacts' | 'tasks' | 'documents';
type Row = { id: string; values: unknown[] };
type ReadMetadata = {
  dateNormalization?: string;
  spreadsheetTitle?: string;
  spreadsheetLocale?: string;
  spreadsheetTimeZone?: string;
};
type Data = Record<Part, Row[]> & { financials?: Row[]; _meta?: ReadMetadata };
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
const icons = { customers: Users, contacts: Phone, tasks: CalendarCheck, cases: BriefcaseBusiness, documents: Files };
const descriptions: Record<Part, string> = {
  customers: 'ค้นหาบริษัท ตรวจข้อมูล และเตรียมการติดต่อครั้งถัดไป',
  contacts: 'บริษัทละหนึ่งแถว · คลิกจำนวนครั้งที่ติดต่อเพื่อดูประวัติทั้งหมด',
  tasks: 'เริ่มจากงานวันนี้ ตรวจงานเกินกำหนด และเปิดดูรายละเอียด',
  cases: 'ตรวจสถานะเคส งานที่เกี่ยวข้อง และเอกสารของลูกค้า',
  documents: 'ตรวจรายการเอกสารและความครบถ้วนของแต่ละเคส',
};
const columns: Record<Part, number[]> = {
  customers: [2, 14],
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
  financials: [],
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
  return `"${text.replace(/"/g, '""')}"`;
};


export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [part, setPart] = useState<Part>('customers');
  const [data, setData] = useState<Data>(blankData());
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [part, query, pageSize]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dataLoadError, setDataLoadError] = useState('');
  const [dataFetchedAt, setDataFetchedAt] = useState('');
  const [datesVerified, setDatesVerified] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [financialFilter, setFinancialFilter] = useState<'all' | OverallStatus>('all');
  const [businessTypeFilter, setBusinessTypeFilter] = useState<string[]>([]);
  const [registrySort, setRegistrySort] = useState<RegistrySort | null>(null);
  const changeRegistrySort = (key: RegistrySortKey) => {
    setRegistrySort(previous => ({
      key,
      direction: previous?.key === key && previous.direction === 'asc' ? 'desc' : 'asc',
    }));
    setPage(1);
  };
  const resetRegistrySort = () => {
    setRegistrySort(null);
    setPage(1);
  };
  const registrySortLabel = registrySortOptions.find(option => option.key === registrySort?.key)?.label || '';
  const registrySortMessage = 'แสดงบริษัทที่ยังไม่ได้ติดต่อก่อน · ' + (registrySort
    ? 'เรียงตาม' + registrySortLabel + 'ภายในแต่ละกลุ่ม · ' + (registrySort.direction === 'asc' ? 'น้อยไปมาก ↑' : 'มากไปน้อย ↓')
    : 'ลำดับเริ่มต้นภายในแต่ละกลุ่ม');
  useEffect(() => { setPage(1); }, [financialFilter, businessTypeFilter]);
  const [record, setRecord] = useState<Row | null>(null);
  const [contactContext, setContactContext] = useState<{ customerId?: string; caseId?: string } | null>(null);
  const [customerImportOpen, setCustomerImportOpen] = useState(false);
  const [financialCustomer, setFinancialCustomer] = useState<Row | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Row | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingCustomerId, setDeletingCustomerId] = useState('');
  const [financialProfileExpanded, setFinancialProfileExpanded] = useState(false);
  const [values, setValues] = useState<unknown[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<
    'checking' | 'connected' | 'mismatch' | 'error'
  >('checking');
  const [sheetMessage, setSheetMessage] = useState('');

  useEffect(() => {
    if (!selectedCustomer && !deleteTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (deleteTarget && !deletingCustomerId) {
          setDeleteTarget(null);
          setDeleteConfirmation('');
        } else if (selectedCustomer) {
          setSelectedCustomer(null);
          setFinancialProfileExpanded(false);
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedCustomer, deleteTarget, deletingCustomerId]);

  const loadInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const load = async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setLoading(true);
    setError('');
    setDataLoadError('');
    try {
      const response = await api.get('/api/data');
      const next = response.data as Data;
      setData(next);
      setSheetStatus('connected');
      setSheetMessage('');
      setDatesVerified(next._meta?.dateNormalization === 'google_serial_v1');
      setDataLoaded(true);
      setDataFetchedAt(new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }).format(new Date()));
    } catch (cause) {
      const responseMessage = (cause as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(responseMessage || (cause instanceof Error ? cause.message : 'โหลดข้อมูลไม่สำเร็จ'));
      setDataLoadError(responseMessage || 'โหลดข้อมูลไม่สำเร็จ');
      setSheetStatus('error');
      setSheetMessage(responseMessage || 'โหลดข้อมูลไม่สำเร็จ');
      setDatesVerified(false);
    } finally {
      loadInFlight.current = false;
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
        } catch (cause) {
          const status = (cause as { response?: { status?: number } })?.response?.status;
          if (status === 401 || status === 403) await auth.signOut();
          setError('ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาลองใหม่ หรือตรวจการตั้งค่าผู้ดูแล');
        }
      })
      .catch(() => setError('เข้าสู่ระบบไม่สำเร็จ'));
  }, []);
  useEffect(() => {
    if (!user) return;
    void load();
  }, [user]);

  const spec = specs.find(item => item.key === part)!;
  const customerSpec = specs.find(item => item.key === 'customers')!;
  const companyNameIndex = customerSpec.headers.indexOf('ชื่อบริษัท');
  const phoneIndex = customerSpec.headers.indexOf('เบอร์โทรศัพท์');
  const registrationIndex = customerSpec.headers.indexOf('เลขทะเบียนนิติบุคคล (13 หลัก)');
  const registeredAtIndex = customerSpec.headers.indexOf('วันที่จดทะเบียน');
  const directorsIndex = customerSpec.headers.indexOf('รายชื่อกรรมการ');
  const companySearch =
    part === 'customers' ? getCompanySearchLink(spec.headers, values) : null;
  const customerAssessments = useMemo(
    () => new Map(data.customers.map(row => [row.id, assessFinancials(data.financials || [], row.id)])),
    [data.customers, data.financials]
  );
  const contactCompanies = useMemo(
    () => groupContactHistory(data.contacts, data.customers),
    [data.contacts, data.customers]
  );
  const contactedCustomerIds = useMemo(
    () => new Set(contactCompanies.filter(company => company.linked && company.records.length > 0)
      .map(company => company.customerId)),
    [contactCompanies]
  );
  const visibleContactCompanies = useMemo(
    () => filterContactCompanies(contactCompanies, query),
    [contactCompanies, query]
  );
  const businessTypeOptions = useMemo(() => registryBusinessTypeOptions(data.customers), [data.customers]);
  const visibleRows = useMemo(
    () => {
      if (part === 'customers') return prioritizeUncontactedCustomers(sortCustomerRegistryRows(
        filterCustomerRegistryRows(data.customers, query, financialFilter, customerAssessments, businessTypeFilter),
        registrySort,
        customerAssessments
      ), contactedCustomerIds);
      return (data[part] || []).filter(row => {
        const matchesQuery = !query || row.values.some(v =>
          String(v ?? '').toLowerCase().includes(query.toLowerCase())
        );
        return matchesQuery;
      });
    },
    [data, part, query, financialFilter, customerAssessments, registrySort, businessTypeFilter, contactedCustomerIds]
  );
  const customerSummary = useMemo(() => {
    const summary = { total: 0, pass: 0, fail: 0, incomplete: 0 };
    if (part !== 'customers') return summary;
    for (const row of filterCustomerRegistryRows(data.customers, query, 'all', customerAssessments, businessTypeFilter)) {
      summary.total += 1;
      const status = customerAssessments.get(row.id)?.overall || 'incomplete';
      summary[status] += 1;
    }
    return summary;
  }, [part, data.customers, query, customerAssessments, businessTypeFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedRows = visibleRows.slice(pageStart, pageStart + pageSize);
  const hasRegistryFilters = !!query || (part === 'customers' && (financialFilter !== 'all' || businessTypeFilter.length > 0));
  const clearRegistryFilters = () => {
    setQuery('');
    setFinancialFilter('all');
    setBusinessTypeFilter([]);
    setPage(1);
  };
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
  const readModel = useMemo(() => buildReadModel(data), [data]);
  const casesWithoutTask = [...readModel.cases.values()].filter(loan => caseSummary(readModel, loan).openCount === 0).length;

  const beginContact = (context: { customerId?: string; caseId?: string } = {}) => {
    setSelectedCustomer(null);
    setFinancialProfileExpanded(false);
    setRecord(null);
    setPart('contacts');
    setQuery('');
    setContactContext(context);
    setError('');
    setNotice('');
  };
  const openCompanyProfile = (customer: Row, showFinancials = false) => {
    setFinancialProfileExpanded(showFinancials);
    setSelectedCustomer(customer);
  };
  const openDeleteCompany = (customer: Row) => {
    setSelectedCustomer(null);
    setFinancialProfileExpanded(false);
    setDeleteConfirmation('');
    setDeleteTarget(customer);
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
    const initial = [...row.values];
    if (part === 'customers') {
      const businessIndex = spec.headers.indexOf('ประเภทธุรกิจ');
      const savedBusinessType = customerBusinessType(row);
      if (isBlank(initial[businessIndex]) && savedBusinessType) initial[businessIndex] = savedBusinessType;
    }
    setRecord(row);
    setValues(initial);
    setError('');
  };
  const setField = (index: number, value: string) =>
    setValues(current => {
      const legacyIndex = spec.headers.indexOf('ชื่อเรียก / ชื่อร้าน');
      const clearLegacyBusinessType = part === 'customers' && spec.headers[index] === 'ประเภทธุรกิจ' &&
        value === '' && (spec.options[String(index)] || []).includes(String(current[legacyIndex] ?? '').trim());
      return current.map((old, i) => {
        if (i === index) return value === '' ? null : value;
        if (clearLegacyBusinessType && i === legacyIndex) return null;
        return old;
      });
    });
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

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!record || saveInFlight.current) return;
    if (!window.confirm('ยืนยันบันทึกการแก้ไขลง Google Sheets จริง?')) return;
    saveInFlight.current = true;
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
      saveInFlight.current = false;
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

  async function deleteCompany() {
    if (!deleteTarget) return;
    const companyName = String(deleteTarget.values[companyNameIndex] || deleteTarget.id);
    if (deleteConfirmation.trim() !== companyName) {
      setError('กรุณาพิมพ์ชื่อบริษัทให้ตรงก่อนยืนยันลบ');
      return;
    }
    setDeletingCustomerId(deleteTarget.id);
    setError('');
    setNotice('');
    try {
      const response = await api.delete(`/api/records/customers/${encodeURIComponent(deleteTarget.id)}`);
      const result = response.data as { data: Data; deletedFinancials?: number };
      setData(result.data);
      setDeleteTarget(null);
      setDeleteConfirmation('');
      setNotice(`ลบบริษัท ${companyName} และข้อมูลงบที่เชื่อมโยง ${result.deletedFinancials || 0} รายการแล้ว`);
    } catch (cause) {
      const responseMessage = (cause as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(responseMessage || (cause instanceof Error ? cause.message : 'ลบบริษัทไม่สำเร็จ'));
    } finally {
      setDeletingCustomerId('');
    }
  }

  function exportCsv() {
    const exportRows = part === 'contacts'
      ? visibleContactCompanies.flatMap(company => company.records)
      : visibleRows;
    const lines = [
      spec.headers.map(escCsv).join(','),
      ...exportRows.map(row => row.values.map(escCsv).join(',')),
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
      await auth.signInWithRedirect({ scope: 'openid email profile offline_access' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เข้าสู่ระบบไม่สำเร็จ');
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
      <a className="skip-link" href="#workspace-content">ข้ามไปยังรายการ</a>
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
            <div className="workspace-layout">
        <aside className="workspace-sidebar">
          <p className="sidebar-caption">พื้นที่ทำงาน</p>
          <nav className="tabs" aria-label="เมนูหลัก">
            {tabOrder.map(key => {
              const Icon = icons[key];
              return (
                <button
                  type="button"
                  className={part === key ? 'selected' : ''}
                  aria-current={part === key ? 'page' : undefined}
                  key={key}
                  onClick={() => {
                    setPart(key);
                    setQuery('');
                    setFinancialFilter('all');
                    setRecord(null);
                    setContactContext(null);
                    setCustomerImportOpen(false);
                    setShowLegacy(false);
                  }}
                >
                  <Icon size={19} aria-hidden="true" />
                  {names[key]} <span>{!dataLoaded ? '—' : key === 'contacts' ? contactCompanies.length : data[key]?.length || 0}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-help">
            <strong>เริ่มงานอย่างเป็นขั้นตอน</strong>
            <p>เลือกลูกค้า → ตรวจข้อมูล → บันทึกการติดต่อ → ทบทวนงานติดตาม</p>
          </div>
        </aside>
      <main className="main" id="workspace-content" tabIndex={-1}>
        {dataLoadError && <div role="alert" className="error-banner">
          {dataLoadError} <button type="button" disabled={loading} onClick={() => void load()}>ลองเชื่อมต่อใหม่</button>
          <span> ร่างที่กรอกยังอยู่ หากยังไม่ยืนยันการบันทึก ให้ตรวจรายการล่าสุดก่อนกดซ้ำ</span>
        </div>}
        <section className="heading">
          <div>
            <p className="eyebrow">SME FREEDOM DESK</p>
            <h1>{names[part]}</h1>
            <p className="muted">{descriptions[part]}</p>
          </div>
          <div className="connection-status" data-state={sheetStatus} role="status">
            <span className="connection-dot" aria-hidden="true" />
            {sheetStatus === 'checking' ? 'กำลังตรวจการเชื่อมต่อ'
              : sheetStatus === 'connected' ? 'เชื่อมต่อ Google Sheets'
              : sheetStatus === 'mismatch' ? 'หัวตารางไม่ตรง' : 'เชื่อมต่อไม่สำเร็จ'}
          </div>
        </section>
        {sheetStatus !== 'connected' && sheetStatus !== 'checking' && (
          <p className="error-banner" role="alert">
            {sheetMessage || 'กรุณาตรวจการเชื่อมต่อ Google Sheets'} · ปิดการแก้ไขจนกว่าจะเชื่อมต่อสำเร็จ
          </p>
        )}
        <details className="workspace-overview">
          <summary>ภาพรวมลูกค้าและวงเงิน <span>เปิดดูข้อมูลสรุป</span></summary>
          <section className="stats" aria-label="ภาพรวมข้อมูลที่โหลด">
            <Stat label="ลูกค้าใช้งาน" value={dataLoaded ? customerCount : '—'} />
            <Stat label="เคสสินเชื่อ" value={dataLoaded ? data.cases.length : '—'} />
            <Stat label="วงเงินที่ขอ" value={dataLoaded ? money(requested) : '—'} />
            <Stat label="อนุมัติ / เบิกจ่าย" value={dataLoaded ? `${money(approved)} / ${money(disbursed)}` : '—'} />
          </section>
          <p className="overview-note">เคสที่ยังไม่มีงานถัดไป: {dataLoaded ? casesWithoutTask : '—'} เคส · จำนวนเคสแยกจากจำนวนลูกค้า{dataLoadError ? ' · ข้อมูลเดิมก่อนการโหลดที่ไม่สำเร็จ' : ''}</p>
        </details>
        <section className="section-heading">
          <div>
            <h2>{part === 'customers' ? 'รายชื่อลูกค้า' : part === 'contacts' ? 'บริษัทที่มีประวัติการติดต่อ' : names[part]}</h2>
            <small>{dataLoadError ? 'โหลดข้อมูลไม่สำเร็จ · ตรวจข้อความแจ้งเตือน' : loading ? 'กำลังโหลดข้อมูล…' : dataFetchedAt ? `ข้อมูลล่าสุดที่ดึง: ${dataFetchedAt}` : 'กำลังเตรียมข้อมูล'}</small>
          </div>
          <div className="actions">
            <button className="button" hidden={(part === 'cases' || part === 'tasks') && !showLegacy} onClick={exportCsv}>
              {part === 'cases' || part === 'tasks' ? 'Export CSV ตารางเดิม' : part === 'contacts' ? 'Export CSV ประวัติ' : 'Export CSV'}
            </button>
            <button
              className="button"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={16} aria-hidden="true" className={loading ? 'is-spinning' : ''} />
              {loading ? 'กำลังโหลด' : 'รีเฟรช'}
            </button>
            {part === 'customers' ? (
              <button className="button primary" type="button" onClick={() => setCustomerImportOpen(true)} disabled={loading || sheetStatus !== 'connected'}><Plus size={17} aria-hidden="true" /> เพิ่มรายชื่อ</button>
            ) : part === 'contacts' ? (
              <button className="button primary" data-add-contact type="button" onClick={() => beginContact()} disabled={loading || sheetStatus !== 'connected'}><Plus size={17} aria-hidden="true" /> บันทึกการติดต่อ</button>
            ) : <small className="small-note">เพิ่มประวัติการติดต่อได้จากแท็บประวัติการติดต่อ</small>}
          </div>
        </section>
        <div className="registry-filters" hidden={part === 'cases' || part === 'tasks' || part === 'documents'}>
          <label className="registry-search">
            <span>ค้นหา{names[part]}</span>
            <div className="search-control">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                className="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={part === 'customers' ? 'ชื่อบริษัท เบอร์โทร หรือเลขทะเบียน' : 'พิมพ์คำที่ต้องการค้นหา'}
              />
            </div>
          </label>
          {part === 'customers' && (
            <label className="financial-filter">
              <span><SlidersHorizontal size={14} aria-hidden="true" /> เกณฑ์ก่อนติดต่อ</span>
              <select value={financialFilter} onChange={event => setFinancialFilter(event.target.value as typeof financialFilter)}>
                <option value="all">ทั้งหมด</option>
                <option value="pass">ผ่านเกณฑ์กรองเบื้องต้น</option>
                <option value="fail">ไม่เข้าเกณฑ์กรองเบื้องต้น</option>
                <option value="incomplete">ข้อมูลไม่พอประเมิน</option>
              </select>
            </label>
          )}
          {hasRegistryFilters && <button className="button reset-filters" type="button" onClick={clearRegistryFilters}>ล้างตัวกรอง</button>}
        </div>
        {part === 'customers' && (
          <>
            <details className="registry-business-filter">
              <summary>ประเภทธุรกิจ · {businessTypeFilter.length ? 'เลือก ' + businessTypeFilter.length + ' ประเภท' : 'ทั้งหมด'}</summary>
              <fieldset>
                <legend>เลือกประเภทธุรกิจที่ต้องการแสดง</legend>
                <div className="registry-business-options">
                  {businessTypeOptions.map(option => (
                    <label key={option.value}>
                      <input
                        type="checkbox"
                        aria-label={option.label}
                        checked={businessTypeFilter.includes(option.value)}
                        onChange={event => setBusinessTypeFilter(current => event.target.checked
                          ? [...current, option.value]
                          : current.filter(value => value !== option.value))}
                      />
                      <span>{option.label}</span><small>{option.count}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="registry-business-filter-footer">
                <small>เลือกได้หลายประเภท · ไม่เลือกจะแสดงทั้งหมด</small>
                <button className="button" type="button" disabled={!businessTypeFilter.length}
                  onClick={() => setBusinessTypeFilter([])}>แสดงทั้งหมด</button>
              </div>
            </details>
            <div className="registry-sort-toolbar">
              <p className="registry-sort-desktop-hint" aria-live="polite">{registrySortMessage}</p>
              <div className="registry-sort-mobile">
                <label>เรียงลูกค้าตาม
                  <select
                    value={registrySort?.key || ''}
                    onChange={event => {
                      if (!event.target.value) resetRegistrySort();
                      else changeRegistrySort(event.target.value as RegistrySortKey);
                    }}
                  >
                    <option value="">ลำดับเดิม</option>
                    {registrySortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
                <button className="button" type="button" disabled={!registrySort}
                  onClick={() => registrySort && changeRegistrySort(registrySort.key)}>
                  {registrySort?.direction === 'desc' ? 'มากไปน้อย ↓' : 'น้อยไปมาก ↑'}
                </button>
              </div>
              {registrySort?.key === 'screening' && <p>{registrySort.direction === 'asc'
                ? 'ผ่านเกณฑ์ → ไม่ผ่านเกณฑ์ → ข้อมูลไม่พอ'
                : 'ข้อมูลไม่พอ → ไม่ผ่านเกณฑ์ → ผ่านเกณฑ์'}</p>}
              {registrySort && <button className="button" type="button" onClick={resetRegistrySort}>คืนลำดับเดิม</button>}
            </div>
            <section className="customer-summary-grid" aria-label="กรองลูกค้าตามเกณฑ์เบื้องต้น">
              {([
                ['all', 'ทั้งหมด', customerSummary.total],
                ['pass', 'ผ่านเกณฑ์', customerSummary.pass],
                ['fail', 'ไม่ผ่านเกณฑ์', customerSummary.fail],
                ['incomplete', 'ข้อมูลไม่พอ', customerSummary.incomplete],
              ] as const).map(([filter, label, count]) => (
                <button className={filter} type="button" key={filter} aria-pressed={financialFilter === filter} onClick={() => setFinancialFilter(filter)}>
                  <span>{label}</span><strong>{dataLoaded ? count : '—'}</strong>
                </button>
              ))}
            </section>
            <p className="screening-disclaimer">เกณฑ์กรองการเงินเบื้องต้น ไม่ใช่ผลอนุมัติสินเชื่อ · ตรวจข้อห้ามติดต่อและ Call Verify ก่อนติดต่อทุกครั้ง</p>
          </>
        )}
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
        {financialCustomer && part === 'customers' && <FinancialEditorDialog
          customer={financialCustomer}
          companyName={String(financialCustomer.values[companyNameIndex] || financialCustomer.id)}
          rows={data.financials || []}
          disabled={loading || sheetStatus !== 'connected'}
          onClose={() => setFinancialCustomer(null)}
          onSaved={(saved, replayed) => {
            setData(current => ({
              ...current,
              financials: [...(current.financials || []).filter(row => row.id !== saved.id), saved],
            }));
            setFinancialCustomer(null);
            setNotice(replayed ? 'ยืนยันข้อมูลงบรายการเดิมแล้ว ไม่สร้างซ้ำ' : 'บันทึกข้อมูลงบและคำนวณเกณฑ์ใหม่แล้ว');
          }}
        />}
        {selectedCustomer && part === 'customers' && (
          <div
            className="modal-backdrop"
            onClick={event => {
              if (event.target === event.currentTarget) {
                setSelectedCustomer(null);
                setFinancialProfileExpanded(false);
              }
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

                </div>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setFinancialProfileExpanded(false);
                  }}
                  aria-label="ปิดข้อมูลบริษัท"
                >
                  ปิด
                </button>
              </div>
              <div className="company-profile-content">
                <p className="small-note details-note">ข้อมูลสำคัญสำหรับตรวจสอบบริษัทและประเมินเบื้องต้นก่อนติดต่อ</p>
                <div className="details-grid company-profile-grid">
                  {[
                    ['ชื่อบริษัท', companyNameIndex],
                    ['เลขทะเบียนนิติบุคคล (13 หลัก)', registrationIndex],
                    ['วันที่จดทะเบียนจัดตั้ง', registeredAtIndex],
                    ['รายชื่อผู้เป็นหุ้นส่วน / กรรมการ', directorsIndex],
                  ].map(([label, rawIndex]) => {
                    const index = Number(rawIndex);
                    const value = selectedCustomer.values[index];
                    return <div className={`detail-field ${index === directorsIndex ? 'wide' : ''}`} key={String(label)}>
                      <span>{label}</span>
                      <strong>{isBlank(value) ? '—' : String(value)}</strong>
                    </div>;
                  })}
                </div>
                <section className="company-financial-section">
                  <button
                    className="button financial-profile-toggle"
                    type="button"
                    aria-expanded={financialProfileExpanded}
                    aria-controls={`financial-profile-${selectedCustomer.id}`}
                    onClick={() => setFinancialProfileExpanded(expanded => !expanded)}
                  >
                    {financialProfileExpanded ? 'ซ่อนข้อมูลงบการเงิน' : 'ดูข้อมูลงบการเงิน'}
                  </button>
                  {financialProfileExpanded && <div id={`financial-profile-${selectedCustomer.id}`} className="financial-profile-panel">
                    <div className="company-financial-heading">
                      <div><p className="eyebrow">FINANCIAL PROFILE</p><h3>ข้อมูลงบการเงิน</h3></div>
                      <button className="button primary" type="button" disabled={loading || sheetStatus !== 'connected'} onClick={() => {
                        const customer = selectedCustomer;
                        setSelectedCustomer(null);
                        setFinancialProfileExpanded(false);
                        setFinancialCustomer(customer);
                      }}>เพิ่ม/แก้ไขงบ</button>
                    </div>
                    <div className="company-financial-layout">
                      <div><h4>งบย้อนหลัง</h4><FinancialHistory customerId={selectedCustomer.id} rows={data.financials || []} /></div>
                      <div><h4>เกณฑ์ก่อนติดต่อ</h4><FinancialScreeningCell customerId={selectedCustomer.id} rows={data.financials || []} /></div>
                    </div>
                    <div className="financial-usage-note">
                      <strong>วิธีใช้งาน</strong>
                      <ol>
                        <li>กรอกปีล่าสุดก่อน หากขาดทุนให้กรอกปีก่อนหน้าต่อเนื่อง สูงสุด 3 ปี</li>
                        <li>ปีล่าสุดไม่ขาดทุน หรือพบปีที่ไม่ขาดทุนระหว่างตรวจย้อนหลัง ถือว่าผ่านด้านผลประกอบการ</li>
                        <li>ขาดทุนครบ 3 ปีติดต่อกันถือว่าไม่ผ่าน</li>
                        <li>ดอกเบี้ยจ่าย ÷ รายได้รวม × 100 ต้องต่ำกว่า 5% โดย 5% พอดีถือว่าไม่ผ่าน</li>
                        <li>ข้อมูลไม่ครบจะแสดง “ข้อมูลไม่พอประเมิน”</li>
                      </ol>
                    </div>
                  </div>}
                </section>
              </div>
              <div className="modal-foot">
                <button className="button primary" type="button" disabled={loading || sheetStatus !== 'connected'} onClick={() => beginContact({ customerId: selectedCustomer.id })}>เพิ่มประวัติการติดต่อ</button>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setFinancialProfileExpanded(false);
                  }}
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </section>
          </div>
        )}
        {deleteTarget && (() => {
          const companyName = String(deleteTarget.values[companyNameIndex] || deleteTarget.id);
          const linked = {
            cases: data.cases.filter(row => String(row.values[1] ?? '') === deleteTarget.id).length,
            contacts: data.contacts.filter(row => String(row.values[1] ?? '') === deleteTarget.id).length,
            tasks: data.tasks.filter(row => String(row.values[1] ?? '') === deleteTarget.id).length,
            financials: (data.financials || []).filter(row => String(row.values[1] ?? '') === deleteTarget.id).length,
          };
          const hasLinkedOperations = linked.cases + linked.contacts + linked.tasks > 0;
          const deleting = deletingCustomerId === deleteTarget.id;
          return <div className="modal-backdrop delete-company-backdrop">
            <section className="modal delete-company-modal" role="dialog" aria-modal="true" aria-labelledby="delete-company-title">
              <div className="modal-head">
                <div>
                  <small>ลบข้อมูลบริษัท</small>
                  <h2 id="delete-company-title">{companyName}</h2>
                </div>
                <button className="button" type="button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteConfirmation(''); }} aria-label={`ปิดหน้าต่างลบบริษัท ${companyName}`}>ปิด</button>
              </div>
              <div className="delete-company-content">
                {hasLinkedOperations ? <div className="delete-blocked-message" role="alert">
                  <strong>ยังลบบริษัทนี้ไม่ได้</strong>
                  <p>พบข้อมูลเชื่อมโยง: เคส {linked.cases} รายการ, ประวัติติดต่อ {linked.contacts} รายการ และงานติดตาม {linked.tasks} รายการ</p>
                  <p>เพื่อไม่ให้ประวัติงานสูญหาย กรุณาแก้ไขทะเบียนและเปลี่ยนสถานะเป็น “เก็บถาวร” แทน</p>
                </div> : <>
                  <p className="delete-warning"><strong>การลบนี้กู้คืนไม่ได้</strong> บริษัทจะถูกลบออกจาก Google Sheets และข้อมูลงบที่เชื่อมโยง {linked.financials} รายการจะถูกลบพร้อมกัน</p>
                  <label className="delete-confirmation-field">
                    <span>พิมพ์ชื่อบริษัท <strong>{companyName}</strong> เพื่อยืนยัน</span>
                    <input name="delete-company-confirmation" autoComplete="off" value={deleteConfirmation} disabled={deleting} onInput={event => setDeleteConfirmation(event.currentTarget.value)} />
                  </label>
                </>}
                {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')}>ปิด</button></div>}
              </div>
              <div className="modal-foot">
                <button className="button" type="button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteConfirmation(''); }}>ยกเลิก</button>
                {!hasLinkedOperations && <button className="button danger" type="button" disabled={deleting || deleteConfirmation.trim() !== companyName} onClick={() => void deleteCompany()} aria-label={`ยืนยันลบบริษัท ${companyName}`}>{deleting ? 'กำลังลบ…' : 'ลบบริษัทถาวร'}</button>}
              </div>
            </section>
          </div>;
        })()}
        {record && (
          <div className="modal-backdrop">
            <form className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-record-title" onSubmit={save}>
              <div className="modal-head">
                <div className="edit-heading">
                  <h2 id="edit-record-title">แก้ไข{names[part]}</h2>
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
              <p className="small-note">{part === 'customers'
                ? 'การบันทึกจะเปลี่ยนข้อมูลจริงใน Google Sheets'
                : 'การบันทึกจะเปลี่ยนข้อมูลจริงใน Google Sheets · รหัสรายการและช่องคำนวณอัตโนมัติแก้ไขไม่ได้'}</p>
              {error && <div className="error-banner">{error}{dataLoadError && <button type="button" disabled={loading} onClick={() => void load()}>ลองเชื่อมต่อใหม่</button>}<button type="button" onClick={() => setError('')}>ปิด</button></div>}
              <div className="form-grid">
                {spec.headers.map((header, index) => {
                  if (part === 'customers' && (index === 0 || header === 'ชื่อเรียก / ชื่อร้าน')) return null;
                  if (part === 'contacts' && header === 'รายละเอียดธุรกิจจากการติดต่อ (JSON)') return null;
                  const FieldIcon = customerFieldIcon(header);
                  return (
                    <label className={spec.longText?.includes(index) || header.length > 38 ? 'wide' : ''} key={header}>
                      <span className={part === 'customers' ? 'customer-field-label' : undefined}>
                        {part === 'customers' && <FieldIcon className="customer-field-icon" size={16} aria-hidden="true" focusable="false" />}
                        <span>{header}{spec.required.includes(index) ? <b className="required"> *</b> : ''}</span>
                      </span>
                      {makeFormControl(index)}
                    </label>
                  );
                })}
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
        <div hidden={part !== 'cases' && part !== 'tasks'}>
          <CaseFollowUpWorkbench data={data} part={part === 'tasks' ? 'tasks' : 'cases'} loaded={dataLoaded} loading={loading} loadError={dataLoadError} fetchedAt={dataFetchedAt} datesVerified={datesVerified} onPartChange={setPart} />
          <button className="button" type="button" aria-expanded={showLegacy} onClick={() => setShowLegacy(s => !s)}>{showLegacy ? 'ซ่อนตารางเดิม' : 'เปิดตารางเดิมสำหรับแก้ไข'}</button>
          {showLegacy && <p className="small-note">ตารางและการแก้ไขเดิมใช้ตัวกรองเดิม ไม่ใช่ตัวกรองของมุมมองใหม่</p>}
        </div>
        <div hidden={(part === 'cases' || part === 'tasks') && !showLegacy} className={part === 'contacts' ? 'contact-history-wrap' : `table-wrap ${part === 'customers' ? 'customer-registry-wrap' : ''}`}>
          {part === 'contacts' ? <ContactHistoryView
            groups={visibleContactCompanies}
            totalCompanies={contactCompanies.length}
            query={query}
            loading={loading}
            loadError={dataLoadError}
            disabled={loading || sheetStatus !== 'connected'}
            onAdd={customerId => beginContact({ customerId })}
            onEdit={beginEdit}
          /> : part === 'documents' ? <DocumentChecklist cases={data.cases} customers={data.customers} documents={data.documents} /> : part === 'customers' ? <table className="customer-registry-table">
            <thead><tr>
              <th scope="col">บริษัท</th>
              <th scope="col">ประเภทธุรกิจ</th>
              <th scope="col">เบอร์โทรศัพท์</th>
              <th scope="col" aria-sort={registryAriaSort(registrySort, ['year', 'profit'])}>
                <span className="registry-sort-heading">งบปีล่าสุด</span>
                <div className="registry-financial-sort">
                  <RegistrySortButton field="year" label="ปีงบ" sort={registrySort} onSort={changeRegistrySort} />
                  <RegistrySortButton field="profit" label="กำไรสุทธิ" sort={registrySort} onSort={changeRegistrySort} />
                </div>
              </th>
              <th scope="col" aria-sort={registryAriaSort(registrySort, ['screening'])}>
                <RegistrySortButton field="screening" label="เกณฑ์ก่อนติดต่อ" sort={registrySort} onSort={changeRegistrySort} />
              </th>
              <th scope="col">การดำเนินการ</th>
            </tr></thead>
            <tbody>
              {pagedRows.map(row => {
                const assessment = customerAssessments.get(row.id)!;
                const companyName = String(row.values[companyNameIndex] || 'ไม่ระบุชื่อบริษัท');
                const registration = row.values[registrationIndex];
                const businessType = customerBusinessType(row);
                const contacted = contactedCustomerIds.has(row.id);
                const writeDisabled = loading || sheetStatus !== 'connected';
                return <tr key={row.id}>
                  <td data-label="บริษัท">
                    <div className="company-registry-cell">
                      <button type="button" className="company-name-button" onClick={() => openCompanyProfile(row)} aria-haspopup="dialog" aria-label={`เปิดข้อมูลบริษัท ${companyName}`}>{companyName}</button>
                      {!isBlank(registration) && <small>เลขทะเบียน {String(registration)}</small>}
                      <span className={`company-contact-status ${contacted ? 'contacted' : 'pending'}`}>
                        {contacted ? 'ได้รับการติดต่อแล้ว' : 'ยังไม่ได้ติดต่อ'}
                      </span>
                    </div>
                  </td>
                  <td data-label="ประเภทธุรกิจ" className={!businessType ? 'muted-financial' : ''}>{businessType || 'ยังไม่ระบุ'}</td>
                  <td data-label="เบอร์โทรศัพท์" className={isBlank(row.values[phoneIndex]) ? 'muted-financial' : ''}>{isBlank(row.values[phoneIndex]) ? 'ไม่มีเบอร์โทร' : String(row.values[phoneIndex])}</td>
                  <td data-label="งบปีล่าสุด" className="latest-financial-cell"><LatestFinancialCell customerId={row.id} rows={data.financials || []} /></td>
                  <td data-label="เกณฑ์ก่อนติดต่อ" className="financial-screening-cell"><RegistryScreeningCell customerId={row.id} rows={data.financials || []} /></td>
                  <td data-label="การดำเนินการ" className="row-actions registry-row-actions">
                    {assessment.overall === 'pass' && <button className="button primary" type="button" disabled={writeDisabled} onClick={() => beginContact({ customerId: row.id })} aria-label={`เริ่มติดต่อ ${companyName}`}>เริ่มติดต่อ</button>}
                    {assessment.overall === 'incomplete' && <button className="button primary" type="button" disabled={writeDisabled} onClick={() => setFinancialCustomer(row)} aria-label={`เพิ่มหรือแก้ไขงบ ${companyName}`}>เพิ่ม/แก้ไขงบ</button>}
                    {assessment.overall === 'fail' && <><span className="registry-action-advice">ไม่แนะนำให้ติดต่อ</span><button className="button" type="button" onClick={() => openCompanyProfile(row, true)} aria-label={`ดูรายละเอียดเกณฑ์ ${companyName}`}>ดูรายละเอียด</button></>}
                    <button className="button ghost" type="button" disabled={writeDisabled} onClick={() => beginEdit(row)} aria-label={`แก้ไขทะเบียน ${companyName}`}>แก้ไขทะเบียน</button>
                    <button className="button danger ghost" type="button" disabled={writeDisabled || deletingCustomerId === row.id} onClick={() => openDeleteCompany(row)} aria-label={`ลบบริษัท ${companyName}`}>ลบบริษัท</button>
                  </td>
                </tr>;
              })}
              {!visibleRows.length && <tr><td colSpan={6} className="empty">
                <strong>{loading ? 'กำลังโหลดข้อมูลลูกค้า…' : dataLoadError ? 'ยังแสดงข้อมูลลูกค้าไม่ได้' : hasRegistryFilters ? 'ไม่พบลูกค้าที่ตรงกับตัวกรอง' : 'เริ่มต้นทะเบียนลูกค้าของคุณ'}</strong>
                <p>{dataLoadError ? 'ตรวจการเชื่อมต่อแล้วกดรีเฟรชอีกครั้ง' : hasRegistryFilters ? 'ลองใช้คำค้นสั้นลง หรือดูรายชื่อทั้งหมด' : 'เพิ่มรายชื่อเพื่อเริ่มตรวจข้อมูลและเตรียมการติดต่อ'}</p>
                {hasRegistryFilters && <button className="button" type="button" onClick={clearRegistryFilters}>ล้างตัวกรอง</button>}
              </td></tr>}
            </tbody>
          </table> : <table>
            <thead><tr>{columns[part].map(index => (<th key={index}>{spec.headers[index]}</th>))}{sheetStatus === 'connected' && <th>การดำเนินการ</th>}</tr></thead>
            <tbody>
              {pagedRows.map(row => <tr key={row.id}>
                {columns[part].map(index => <td key={index}>{displayValue(part, index, row.values[index], data)}</td>)}
                {sheetStatus === 'connected' && <td className="row-actions"><button type="button" onClick={() => beginEdit(row)}>แก้ไข</button>{part === 'cases' && <button type="button" onClick={() => beginContact({ caseId: row.id, customerId: String(row.values[spec.headers.indexOf('รหัสลูกค้า')]) })}>บันทึกการติดต่อ</button>}</td>}
              </tr>)}
              {!visibleRows.length && <tr><td colSpan={columns[part].length + (sheetStatus === 'connected' ? 1 : 0)} className="empty">{loading ? 'กำลังโหลด…' : 'ไม่พบรายการ'}</td></tr>}
            </tbody>
          </table>}
        </div>
        {part !== 'documents' && part !== 'contacts' && (!(part === 'cases' || part === 'tasks') || showLegacy) && visibleRows.length > 0 && (
          <nav className="pagination" aria-label="แบ่งหน้ารายการ">
            <p role="status">แสดง {pageStart + 1}–{Math.min(pageStart + pageSize, visibleRows.length)} จาก {visibleRows.length} รายการ</p>
            <label>ต่อหน้า
              <select value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>
                <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
              </select>
            </label>
            <div className="pagination-buttons">
              <button className="button" type="button" aria-label="หน้าก่อนหน้า" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
              <span>หน้า {currentPage} / {pageCount}</span>
              <button className="button" type="button" aria-label="หน้าถัดไป" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </nav>
        )}
        <p className="workspace-footer">ข้อมูลจาก Google Sheets · การบันทึกจะเปลี่ยนข้อมูลในชีตจริง</p>
      </main>
      </div>
    </div>
  );
}


function registryAriaSort(sort: RegistrySort | null, keys: RegistrySortKey[]): 'ascending' | 'descending' | 'none' {
  if (!sort || !keys.includes(sort.key)) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function RegistrySortButton({
  field, label, sort, onSort,
}: {
  field: RegistrySortKey;
  label: string;
  sort: RegistrySort | null;
  onSort: (key: RegistrySortKey) => void;
}) {
  const active = sort?.key === field;
  const direction = active ? sort.direction : null;
  return (
    <button
      className="registry-sort-button"
      type="button"
      data-active={active}
      onClick={() => onSort(field)}
      aria-label={'เรียงตาม' + label + ' · คลิกเพื่อเรียง' + (direction === 'asc' ? 'มากไปน้อย' : 'น้อยไปมาก')}
    >
      <span>{label}</span>
      <span className="registry-sort-arrow" aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span>
    </button>
  );
}

function customerFieldIcon(header: string) {
  if (header === CONTACT_SEARCH_HEADER) return Search;
  if (header === 'ชื่อบริษัท') return Building2;
  if (header.includes('รหัส') || header.includes('เลขทะเบียน') || header.includes('เลขอ้างอิง')) return Hash;
  if (header.startsWith('วันที่') || header.includes('ปีข้อมูล')) return CalendarDays;
  if (header.includes('รายได้') || header.includes('กำไร') || header.includes('ยอดขาย')) return Banknote;
  if (header.includes('ประเภทธุรกิจ') || header === 'ชื่อเรียก / ชื่อร้าน' || header.includes('ประเภทนิติบุคคล')) return BriefcaseBusiness;
  if (header.includes('พิกัด') || header.includes('Maps')) return MapPinned;
  if (header.includes('จังหวัด') || header.includes('อำเภอ') || header.includes('ที่อยู่')) return MapPin;
  if (header.includes('โทรศัพท์')) return Phone;
  if (header.includes('อีเมล')) return Mail;
  if (header.includes('ผู้ติดต่อ') || header.includes('กรรมการ') || header.includes('หุ้นส่วน')) return Users;
  if (/Facebook|LINE|Instagram|TikTok|YouTube|LinkedIn/.test(header)) return MessageCircle;
  if (/Website|Marketplace/.test(header)) return Globe;
  if (header.includes('แหล่ง')) return Link2;
  if (header.includes('ระงับ')) return ShieldCheck;
  if (header.includes('สถานะ')) return CircleCheck;
  return FileText;
}

function customerName(data: Data, id: unknown) {
  return String(
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


