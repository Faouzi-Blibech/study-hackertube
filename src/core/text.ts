/** Headings from PDFs can be whole sentences; keep section titles readable. */
export function shortTitle(t: string, max = 70): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max) > 20 ? s.lastIndexOf(' ', max) : max)}...`;
}
