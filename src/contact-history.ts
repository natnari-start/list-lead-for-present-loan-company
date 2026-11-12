import { contactIndexes, isContactDateTime, type ContactRow } from './contact-log';
import { toIsoDate } from './google-sheet-date';
import { schemas } from './schema';

export const historyIndexes = contactIndexes();
const customerHeaders = schemas.find(spec => spec.key === 'customers')!.headers as readonly string[];
const companyIndex = customerHeaders.indexOf('ชื่อบริษัท');
const phoneIndex = customerHeaders.indexOf('เบอร์โทรศัพท์');
const registrationIndex = customerHeaders.indexOf('เลขทะเบียนนิติบุคคล (13 หลัก)');
export const historyText = (value: unknown) => String(value ?? '').trim();

export type ContactCompany = {
  key: string;
  customerId: string;
  companyName: string;
  phone: string;
  registration: string;
  linked: boolean;
  records: ContactRow[];
  latest: ContactRow | null;
  unverifiedDates: number;
};

export function contactTimestamp(value: unknown): number | null {
  const normalized = historyText(toIsoDate(value, '', true, true));
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?$/);
  if (!match || !isContactDateTime(match[1])) return null;
  const timestamp = Date.parse(match[1] + (match[2] || '+07:00'));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatContactDate(value: unknown): string {
  const timestamp = contactTimestamp(value);
  if (timestamp === null) {
    const raw = historyText(value);
    return raw ? raw + ' · วันเวลารอตรวจ' : 'ยังไม่ระบุวันเวลา';
  }
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function groupContactHistory(contacts: ContactRow[], customers: ContactRow[]): ContactCompany[] {
  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  const groups = new Map<string, ContactCompany>();
  contacts.forEach((record, index) => {
    const customerId = historyText(record.values[historyIndexes.customerId]);
    const customer = customerMap.get(customerId);
    // An absent relationship must not merge unrelated orphan records.
    const key = customerId ? 'customer:' + customerId : 'unlinked:' + index + ':' + record.id;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        customerId,
        companyName: historyText(customer?.values[companyIndex]) || 'ไม่พบข้อมูลบริษัท',
        phone: historyText(customer?.values[phoneIndex]),
        registration: historyText(customer?.values[registrationIndex]),
        linked: !!customer,
        records: [],
        latest: null,
        unverifiedDates: 0,
      };
      groups.set(key, group);
    }
    group.records.push(record);
  });
  for (const group of groups.values()) {
    group.records.sort((a, b) => {
      const left = contactTimestamp(a.values[historyIndexes.contactedAt]);
      const right = contactTimestamp(b.values[historyIndexes.contactedAt]);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      return (right ?? 0) - (left ?? 0) || a.id.localeCompare(b.id);
    });
    group.unverifiedDates = group.records.filter(record =>
      contactTimestamp(record.values[historyIndexes.contactedAt]) === null
    ).length;
    // Unknown dates can be newer than a known date, so do not label one as latest.
    group.latest = group.unverifiedDates ? null : group.records[0] ?? null;
  }
  return [...groups.values()].sort((a, b) => {
    const left = a.latest ? contactTimestamp(a.latest.values[historyIndexes.contactedAt]) : null;
    const right = b.latest ? contactTimestamp(b.latest.values[historyIndexes.contactedAt]) : null;
    return (right ?? -Infinity) - (left ?? -Infinity) ||
      a.companyName.localeCompare(b.companyName, 'th') || a.key.localeCompare(b.key);
  });
}

export function filterContactCompanies(groups: ContactCompany[], query: string): ContactCompany[] {
  const search = query.trim().toLocaleLowerCase('th-TH');
  if (!search) return groups;
  return groups.filter(group => [
    group.companyName,
    group.phone,
    group.registration,
    ...group.records.flatMap(record => record.values),
  ].some(value => historyText(value).toLocaleLowerCase('th-TH').includes(search)));
}

