/// <reference types="chrome" />
// Finding the PDF in the active tab and fetching its bytes. Host access is requested at click time.

const CHROME_PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';

export class NeedsFileAccessError extends Error {}
export class PermissionDeniedError extends Error {}

/** The real document URL if `url` looks like a PDF (direct .pdf link or Chrome's PDF viewer), else null. */
export function pdfUrlFromTabUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(CHROME_PDF_VIEWER)) {
    // Older Chrome versions wrap the real URL: viewer/index.html?src=<url> or viewer/<url>.
    const rest = url.slice(CHROME_PDF_VIEWER.length);
    const src = new URLSearchParams(rest.split('?')[1] ?? '').get('src');
    const inner = src ?? (/^(https?|file):/.test(rest) ? rest : null);
    return inner ? pdfUrlFromTabUrl(inner) ?? inner : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return null;
  return decodeURIComponent(parsed.pathname).toLowerCase().endsWith('.pdf') ? url : null;
}

/** The tab the user is looking at; when the panel is open as a normal tab, the last other tab used. */
export async function getTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  const own = chrome.runtime.getURL('');
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidates = tabs.filter((t) => !t.url?.startsWith(own));
  const active = tabs.find((t) => t.active);
  if (active && !active.url?.startsWith(own)) return active;
  candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return candidates[0] ?? active;
}

export function fileNameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return last || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

async function ensureAccess(url: string): Promise<void> {
  const { protocol, origin } = new URL(url);
  const pattern = protocol === 'file:' ? 'file:///*' : `${origin}/*`;
  if (protocol === 'file:' && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    throw new NeedsFileAccessError('file access is off');
  }
  if (await chrome.permissions.contains({ origins: [pattern] })) return;
  // Must run inside the click handler: the browser shows its permission prompt.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new PermissionDeniedError(`permission for ${pattern} was not granted`);
}

/** Fetch the PDF behind a tab URL and wrap it in a File for analyzePdf. */
export async function fetchPdfFile(url: string): Promise<File> {
  await ensureAccess(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the PDF (HTTP ${res.status})`);
  const bytes = await res.arrayBuffer();
  return new File([bytes], fileNameFromUrl(url), { type: 'application/pdf' });
}

export const extensionsPageUrl = (): string => `chrome://extensions/?id=${chrome.runtime.id}`;
