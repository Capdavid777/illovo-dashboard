// semper-mcp/server.js
import 'dotenv/config';
import cron from 'node-cron';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { Server, Tool } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/* ========================= ENV / CONFIG ========================= */
// Defaults from what you shared. Move to .env for safety!
const {
  SEMPER_BASE_URL = 'https://web-prod.semper-services.com/auth',
  SEMPER_USERNAME = 'Luba',
  SEMPER_PASSWORD = '0802',
  SEMPER_VENUE_ID = '19205',

  SHEET_ID,
  SHEET_TAB = 'Raw',
  DRIVE_FOLDER_ID,
  XLSX_FILENAME = 'RS Dashboard Data.xlsx',
  CRON = '0 6,14,22 * * *', // 06:00, 14:00, 22:00 daily (server local time)
} = process.env;

if (!SHEET_ID) console.error('[config] Missing SHEET_ID');
if (!DRIVE_FOLDER_ID) console.error('[config] Missing DRIVE_FOLDER_ID');

/* ========================= SMALL HELPERS ========================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function monthEdges(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); // last day this month
  return { start, end };
}

function fmt(d, style = 'iso') {
  // we’ll try multiple formats when typing
  const pad = (n) => String(n).padStart(2, '0');
  if (style === 'iso') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (style === 'slash_uk') return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return d.toLocaleDateString('en-ZA'); // 2025/08/27 on some systems
}

async function waitForAny(page, selectors, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return sel;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timeout waiting for any of: ${selectors.join(' | ')}`);
    }
    await sleep(200);
  }
}

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await page.fill(sel, '');
      await page.type(sel, String(value), { delay: 20 });
      return sel;
    }
  }
  throw new Error(`Could not find input using selectors: ${selectors.join(' | ')}`);
}

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await page.click(sel);
      return sel;
    }
  }
  throw new Error(`Could not find a clickable element among: ${selectors.join(' | ')}`);
}

/* ========================= GOOGLE AUTH ========================= */
async function getGoogleClients() {
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  const client = await auth.getClient();
  return {
    sheets: google.sheets({ version: 'v4', auth: client }),
    drive: google.drive({ version: 'v3', auth: client }),
  };
}

/* ========================= SEMPER SCRAPER ========================= */
/**
 * Steps (per your instructions):
 * 1) Login with Venue ID, Username, Password
 * 2) Click "General" (provided selector); then go to All Reports page
 * 3) Open "History & Forecast" → "Room Types History and Forecast"
 * 4) Set date range (1st → last day of current month)
 * 5) Click "Export to Excel" and capture the download
 * Returns: { rows, xlsxBuffer, filename }
 */
async function fetchSemperReport() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  /* --- 1) LOGIN --- */
  console.log('[semper] goto login:', SEMPER_BASE_URL);
  await page.goto(SEMPER_BASE_URL, { waitUntil: 'domcontentloaded' });

  await fillFirst(page, [
    'input[name="venueId"]',
    'input[name="venue_id"]',
    'input[name="venue"]',
    'input[id*="venue"]',
    'input[placeholder*="Venue"]',
    'input[aria-label*="Venue"]',
  ], SEMPER_VENUE_ID);

  await fillFirst(page, [
    'input[name="username"]',
    'input#username',
    'input[placeholder*="User"]',
    'input[aria-label*="User"]',
    'input[name="user"]',
  ], SEMPER_USERNAME);

  await fillFirst(page, [
    'input[name="password"]',
    'input[type="password"]',
    'input#password',
    'input[placeholder*="Password"]',
    'input[aria-label*="Password"]',
  ], SEMPER_PASSWORD);

  const clickedLogin = await clickFirst(page, [
    'button[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'text=Log in',
    'text=Login',
  ]);
  console.log('[semper] clicked login via:', clickedLogin);

  await page.waitForLoadState('networkidle', { timeout: 30000 });

  /* --- 2) GENERAL → ALL REPORTS --- */
  // Try the exact selector you gave, then fall back to text.
  const generalSel = await (async () => {
    const hard = '#\\34  > div.p-menuitem-content > a > span';
    if (await page.$(hard)) return hard;
    return await waitForAny(page, [
      'a:has-text("General")',
      'span:has-text("General")',
      'button:has-text("General")',
      '[role="menuitem"]:has-text("General")',
    ], 8000);
  })();
  try {
    await page.click(generalSel);
  } catch (e) {
    console.log('[semper] could not click "General" (continuing):', e.message);
  }

  // Go directly to All Reports
  const ALL_REPORTS = 'https://web-prod.semper-services.com/reports/allReports/1';
  console.log('[semper] goto All Reports:', ALL_REPORTS);
  await page.goto(ALL_REPORTS, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  /* --- 3) HISTORY & FORECAST → ROOM TYPES HISTORY AND FORECAST --- */
  // Try your deep selector, else text.
  const histHeaderSel = await (async () => {
    const deep =
      'body > app-root > app-main-layout > div > div.container-fluid > app-all-reports > div > div > div.card-body > div > form > div:nth-child(2) > div:nth-child(3) > div > div:nth-child(4) > div > div > b';
    if (await page.$(deep)) return deep;
    return await waitForAny(page, [
      'b:has-text("History & Forecast")',
      'div:has-text("History & Forecast")',
      'span:has-text("History & Forecast")',
      'button:has-text("History & Forecast")',
      'a:has-text("History & Forecast")',
    ], 8000);
  })();
  await page.click(histHeaderSel).catch(() => {}); // may only need to expand

  const roomTypesSel = await waitForAny(page, [
    'a:has-text("Room Types History and Forecast")',
    'button:has-text("Room Types History and Forecast")',
    'span:has-text("Room Types History and Forecast")',
    'div:has-text("Room Types History and Forecast")',
  ], 15000);
  await page.click(roomTypesSel);
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  // Report viewer URL (should be here after click)
  // If not, force it:
  const VIEWER = 'https://web-prod.semper-services.com/reports/report-viewer';
  if (!page.url().includes('/reports/report-viewer')) {
    console.log('[semper] forcing report-viewer URL:', VIEWER);
    await page.goto(VIEWER, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  }

  /* --- 4) DATE RANGE (first → last day this month) --- */
  const { start, end } = monthEdges();
  // We’ll try a few likely selectors for from/to date inputs:
  const fromSelectors = [
    'input[name="from"]',
    'input[name="fromDate"]',
    'input[formcontrolname="fromDate"]',
    'input[placeholder*="From"]',
    'input[aria-label*="From"]',
    'input#from',
  ];
  const toSelectors = [
    'input[name="to"]',
    'input[name="toDate"]',
    'input[formcontrolname="toDate"]',
    'input[placeholder*="To"]',
    'input[aria-label*="To"]',
    'input#to',
  ];

  // Try multiple formats if necessary
  const formats = [fmt(start, 'iso'), fmt(start, 'slash_uk'), fmt(start)];
  let filledFrom = false;
  for (const f of formats) {
    try {
      await fillFirst(page, fromSelectors, f);
      filledFrom = true;
      break;
    } catch { /* try next format */ }
  }
  if (!filledFrom) console.warn('[semper] could not fill FROM date with any known selector/format');

  const formatsTo = [fmt(end, 'iso'), fmt(end, 'slash_uk'), fmt(end)];
  let filledTo = false;
  for (const f of formatsTo) {
    try {
      await fillFirst(page, toSelectors, f);
      filledTo = true;
      break;
    } catch { /* try next format */ }
  }
  if (!filledTo) console.warn('[semper] could not fill TO date with any known selector/format');

  // Try an action button to run the report
  try {
    const runSel = await waitForAny(page, [
      'button:has-text("View")',
      'button:has-text("Run")',
      'button:has-text("Search")',
      'button:has-text("Apply")',
      'button:has-text("Generate")',
    ], 5000);
    await page.click(runSel);
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {
    // sometimes the report loads automatically
  }

  /* --- 5) EXPORT TO EXCEL --- */
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    (async () => {
      const exportSel = await waitForAny(page, [
        'button:has-text("Export to Excel")',
        'a:has-text("Export to Excel")',
        'button:has-text("Excel")',
        'a:has-text("Excel")',
        '[data-testid*="export"]',
        '[aria-label*="Export"]',
      ], 20000);
      await page.click(exportSel);
    })(),
  ]);

  const suggested = download.suggestedFilename();
  const buf = await download.createReadStream().then(streamToBuffer);
  await browser.close();

  // Convert to rows for writing to Google Sheet.
  let rows = [];
  if (suggested?.toLowerCase().endsWith('.csv')) {
    rows = Papa.parse(buf.toString('utf8').trim()).data;
  } else {
    // Assume XLSX/XLS – take first worksheet
    const wb = XLSX.read(buf, { type: 'buffer' });
    const first = wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, raw: true });
    rows = aoa;
  }

  return { rows, xlsxBuffer: ensureXlsxBuffer(buf, suggested, rows), filename: suggested || 'semper.xlsx' };
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (d) => chunks.push(Buffer.from(d)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// If we downloaded CSV, build an XLSX so we can upload a consistent Excel file.
function ensureXlsxBuffer(originalBuf, filename, rows) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return originalBuf;

  // Build XLSX from rows (CSV case)
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows || []);
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

/* ========================= SHEETS & DRIVE ========================= */
async function writeToSheet(rows) {
  const { sheets } = await getGoogleClients();

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: SHEET_TAB,
  });

  // Avoid empty write when report has no rows
  if (rows && rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: SHEET_TAB,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    // Auto-size some columns
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: await getSheetGid(sheets, SHEET_ID, SHEET_TAB),
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: Math.min(30, rows[0]?.length || 10),
              },
            },
          },
        ],
      },
    });
  }

  return { rows: rows?.length || 0, cols: rows?.[0]?.length || 0 };
}

async function getSheetGid(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find((s) => s.properties.title === tabName);
  return sheet?.properties?.sheetId;
}

async function uploadExcelToDrive(xlsxBuffer) {
  const { drive } = await getGoogleClients();

  // Remove existing with same name
  const list = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and name='${XLSX_FILENAME}' and trashed=false`,
    fields: 'files(id,name)',
  });
  for (const f of list.data.files || []) {
    await drive.files.update({ fileId: f.id, requestBody: { trashed: true } });
  }

  // Upload new
  await drive.files.create({
    requestBody: {
      name: XLSX_FILENAME,
      parents: [DRIVE_FOLDER_ID],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: xlsxBuffer,
    },
  });
}

/* ========================= PIPELINE ========================= */
let LAST_RUN = null;

async function runPipeline() {
  console.log('[pipeline] start');
  const { rows, xlsxBuffer, filename } = await fetchSemperReport();
  console.log('[pipeline] downloaded:', filename, 'rows:', rows?.length || 0);

  const stats = await writeToSheet(rows);
  await uploadExcelToDrive(xlsxBuffer);

  LAST_RUN = { at: new Date().toISOString(), stats };
  console.log('[pipeline] done:', LAST_RUN);
  return LAST_RUN;
}

/* ========================= MCP SERVER (tools) ========================= */
const server = new Server(
  { name: 'semper-mcp', version: '1.1.0' },
  { capabilities: { tools: {} } }
);

server.tool(
  new Tool('semper.pullAndPublish', 'Login to Semper, navigate to Room Types History & Forecast, export Excel, update Sheet, upload XLSX'),
  async () => {
    const result = await runPipeline();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  new Tool('semper.lastRun', 'Show timestamp and row/col counts from last run'),
  async () => ({ content: [{ type: 'text', text: JSON.stringify(LAST_RUN, null, 2) }] })
);

server.connect(new StdioServerTransport());

/* ========================= SCHEDULER ========================= */
if (CRON) {
  cron.schedule(CRON, () => {
    runPipeline().catch((err) => console.error('[scheduler] run failed:', err.message));
  });
  console.log('[scheduler] active CRON:', CRON);
}

/* ========================= SECURITY REMINDER =========================
 * Move these into semper-mcp/.env:
 *  SEMPER_BASE_URL=https://web-prod.semper-services.com/auth
 *  SEMPER_USERNAME=Luba
 *  SEMPER_PASSWORD=0802
 *  SEMPER_VENUE_ID=19205
 *  SHEET_ID=<<your_sheet_id>>
 *  SHEET_TAB=Raw
 *  DRIVE_FOLDER_ID=<<your_drive_folder_id>>
 *  XLSX_FILENAME=RS Dashboard Data.xlsx
 *  CRON=0 6,14,22 * * *
 * =========================================================== */
