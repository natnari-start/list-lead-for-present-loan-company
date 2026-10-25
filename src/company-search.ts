export function getCompanySearchLink(
  headers: readonly string[],
  values: readonly unknown[]
): { name: string; href: string } | null {
  const nameIndex = headers.indexOf('ชื่อบริษัท');
  const name = nameIndex < 0 ? '' : String(values[nameIndex] ?? '').trim();
  if (!name) return null;

  return {
    name,
    href: `https://www.google.com/search?q=${encodeURIComponent(name)}`,
  };
}
