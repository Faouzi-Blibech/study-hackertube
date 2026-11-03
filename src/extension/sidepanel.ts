/// <reference types="chrome" />
import { analyzePdf } from '../core';
import type { AnalysisResult, Progress } from '../core';
import { configureLocalRuntime } from './runtime';
import { renderCourse, renderMatches, renderNotice } from './render';
import { NeedsFileAccessError, PermissionDeniedError, extensionsPageUrl, fetchPdfFile, getTargetTab, pdfUrlFromTabUrl } from './tab';

configureLocalRuntime();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const analyzeBtn = $<HTMLButtonElement>('analyze-tab');
const tabHint = $('tab-hint');
const fileInput = $<HTMLInputElement>('file-input');
const progressBox = $('progress');
const barFill = $('bar-fill');
const progressText = $('progress-text');
const errorBox = $('error');
const noticeBox = $('notice');
const courseBox = $('course');
const resultList = $('results');

let busy = false;
let tabPdfUrl: string | null = null;

function setBusy(value: boolean): void {
  busy = value;
  fileInput.disabled = value;
  analyzeBtn.disabled = value || !tabPdfUrl;
}

function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function onProgress(p: Progress): void {
  // Stage weights: reading 10%, model 40%, embedding 40%, matching 10%.
  const base = { extract: 0, chunk: 0.1, model: 0.1, embed: 0.5, retrieve: 0.9, done: 1 }[p.stage];
  const span = { extract: 0.1, chunk: 0, model: 0.4, embed: 0.4, retrieve: 0.1, done: 0 }[p.stage];
  barFill.style.width = `${Math.round((base + span * p.fraction) * 100)}%`;
  progressText.textContent = p.message;
}

function showResult(result: AnalysisResult): void {
  renderNotice(noticeBox, result);
  renderCourse(courseBox, result);
  renderMatches(resultList, result);
  if (result.matches.length === 0) showError('No videos matched. Try a PDF with more text.');
}

async function run(getFile: () => Promise<File>): Promise<void> {
  if (busy) return;
  setBusy(true);
  errorBox.hidden = true;
  noticeBox.hidden = courseBox.hidden = true;
  resultList.replaceChildren();
  progressBox.hidden = false;
  barFill.style.width = '0';
  progressText.textContent = 'Starting';
  try {
    showResult(await analyzePdf(await getFile(), onProgress));
  } catch (err) {
    showError(describe(err));
  } finally {
    progressBox.hidden = true;
    setBusy(false);
  }
}

function describe(err: unknown): string {
  if (err instanceof NeedsFileAccessError) {
    return `To read local PDFs, open ${extensionsPageUrl()} and turn on "Allow access to file URLs", or use "Choose PDF file" below.`;
  }
  if (err instanceof PermissionDeniedError) return 'Permission to read this page was not granted. Use "Choose PDF file" instead.';
  return err instanceof Error ? err.message : String(err);
}

async function refreshTab(): Promise<void> {
  const tab = await getTargetTab();
  tabPdfUrl = pdfUrlFromTabUrl(tab?.url);
  analyzeBtn.disabled = busy || !tabPdfUrl;
  if (tabPdfUrl) {
    tabHint.textContent = tabPdfUrl.startsWith('file:')
      ? 'Local file: Chrome needs "Allow access to file URLs" enabled for this extension.'
      : '';
  } else {
    tabHint.textContent = tab?.url
      ? 'The current tab does not look like a PDF.'
      : 'Click the StudyHackerTube icon on a PDF tab to analyze it, or choose a file below.';
  }
}

analyzeBtn.addEventListener('click', () => {
  if (tabPdfUrl) void run(() => fetchPdfFile(tabPdfUrl!));
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void run(async () => file);
  fileInput.value = '';
});
chrome.tabs.onActivated.addListener(() => void refreshTab());
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') void refreshTab(); });
void refreshTab();
