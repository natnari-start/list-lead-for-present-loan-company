const GOOGLE_SHEETS_UNIX_EPOCH_OFFSET = 25569;
const DAY_MS = 86_400_000;

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function googleSerialToIso(value: number, includeTime: boolean): string | null {
  if (!Number.isFinite(value)) return null;
  const date = new Date(Math.round((value - GOOGLE_SHEETS_UNIX_EPOCH_OFFSET) * DAY_MS));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, includeTime ? 19 : 10);
}

export function toIsoDate(
  value: unknown,
  locale: string,
  includeTime: boolean,
  strictSheetRead = false
): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return googleSerialToIso(value, includeTime) ?? value;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (iso) {
    const date = iso[1] + '-' + iso[2].padStart(2, '0') + '-' + iso[3].padStart(2, '0');
    if (!validIsoDate(date)) return raw;
    return includeTime && iso[4]
      ? date + 'T' + iso[4].padStart(2, '0') + ':' + iso[5] + ':' + (iso[6] || '00')
      : date;
  }
  // A Google Sheets read must not guess whether 11/4/2026 means 11 April
  // or 4 November. Keeping the raw value lets the UI classify it as pending
  // verification instead of assigning it to an incorrect due-date bucket.
  if (strictSheetRead) return raw;
  const parts = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!parts) return raw;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const yearRaw = Number(parts[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const isUs = /^(en_US|en-US)$/i.test(locale);
  const month = isUs ? first : second;
  const day = isUs ? second : first;
  const date = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  if (month < 1 || month > 12 || !validIsoDate(date)) return raw;
  return includeTime && parts[4]
    ? date + 'T' + parts[4].padStart(2, '0') + ':' + parts[5] + ':' + (parts[6] || '00')
    : date;
}

