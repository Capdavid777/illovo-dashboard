// semper-mcp/server.js
import 'dotenv/config';
import cron from 'node-cron';
import Papa from 'papaparse';
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { Server, Tool } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/* ========================= ENV / CONFIG ========================= */
// You gave:
//  - URL: https://web-prod.semper-services.com/auth
//  - Username: Luba
//  - Password: 0802
//  - Venue ID: 19205
// These are used as defaults but should live in .env for safety.

const {
  SEMPER_BASE_URL = 'https://web-prod.semper-services.com/auth',
  SEMPER_USERNAME = 'Luba',
  SEMPER_PASSWORD = '0802',
  SEMPER_VENUE_ID = '19205',

  // Optional: if you know the exact export page AFTER login, put it here.
  // Example: https://web-prod.semper-services.com/reports/daily/export
  SEMPER_EXPORT_URL,

  // Optional: comma-separated button texts to try for download
  // e.g., "Export CSV,Download CSV,Export to CSV"
  SEMPER_DOWNLOAD_TEXT = 'Export CSV,Download CSV,Export to CSV',

  SHEET_ID,
  SHEET_TAB = 'Raw',
  DRIVE_FOLDER_ID,
  XLSX_FILENAME = 'RS Dashboard Data.xlsx',
  CRON = '0 6,14,22 * * *', // 06:00, 14:00, 22:00 (server timezone)
} = process.env;

if (!SHEET_ID) console.error('[config] Missing SHEET_ID');
if (!DRIVE_FOLDER_ID) console.error('[config] Missing DRIVE_FOLDER_ID');

/* ========================= SMALL HELPERS ========================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForAny(page, selectors, timeout = 15000) {
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
      await page.fill(sel, String(value));
      return sel;
    }
  }
  throw new Error(`Could not find input for value "${value}" using selectors: ${selectors.join(' | ')}`);
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
 * Login to Semper and download a CSV export.
 * Returns the CSV text (utf-8).
 *
 * NOTE: After login, if SEMPER_EXPORT_URL is set, we go there directly.
 * Otherwise we try a few generic "Reports/Export" clicks and then a CSV button.
 */
async function fetchSemperCsv() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  // 1) Login
  console.log('[semper] opening login:', SEMPER_BASE_URL);
  await page.goto(SEMPER_BASE_URL, { waitUntil: 'domcontentloaded' });

  // Try a variety of selectors that commonly appear on auth pages.
  // Venue ID
  await fillFirst(page, [
    'input[name="venueId"]',
    'input[name="venue_id"]',
    'input[name="venue"]',
    'input[id*="venue"]',
    'input[placeholder*="Venue"]',
    'input[aria-label*="Venue"]',
  ], SEMPER_VENUE_ID);

  // Username
  await fillFirst(page, [
    'input[name="username"]',
    'input#username',
    'input[placeholder*="User"]',
    'input[aria-label*="User"]',
    'input[name="user"]',
  ], SEMPER_USERNAME);

  // Password
  await fillFirst(page, [
    'input[name="password"]',
    'input[type="password"]',
    'input#password',
    'input[placeholder*="Password"]',
    'input[aria-label*="Password"]',
  ], SEMPER_PASSWORD);

  // Click a login/submit button
  const loginClicked = await clickFirst(page, [
    'button[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'text=Log in',
    'text=Login',
    'text=Sign in',
  ]);
  console.log('[semper] clicked login via:', loginClicked);

  // Wait for post-login load
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await sleep(500);

  // 2) Navigate to export page (if known), else try to find Reports/Export
  if (SEMPER_EXPORT_URL) {
    console.log('[semper] going to export URL:', SEMPER_EXPORT_URL);
    await page.goto(SEMPER_EXPORT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } else {
    console.log('[semper] trying to reach a reports/export view automatically …');
    // Try a few generic paths
    const guesses = [
      'a:has-text("Reports")',
      'a:has-text("Report")',
      'button:has-text("Reports")',
      'button:has-text("Report")',
      'nav :has-text("Reports")',
    ];
    try {
      const found = await waitForAny(page, guesses, 10000).catch(() => null);
      if (found) {
        await page.click(found);
        await page.waitForLoadState('networkidle', { timeout: 20000 });
      }
    } catch (e) {
      console.log('[semper] could not auto-open reports menu (continuing):', e.message);
    }
  }

  // 3) Trigger the CSV download
  const texts = SEMPER_DOWNLOAD_TEXT.split(',').map((s) => s.trim()).filter(Boolean);
  const buttonSelectors = [
    ...texts.map((t) => `button:has-text("${t}")`),
    ...texts.map((t) => `a:has-text("${t}")`),
    '[data-testid*="export"]',
    '[data-test*="export"]',
    '[aria-label*="export"]',
    'button:has-text("CSV")',
    'a:has-text("CSV")',
  ];

  console.log('[semper] looking for export control among:', buttonSelectors.join(' | '));

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    (async () => {
      const sel = await waitForAny(page, buttonSelectors, 20000);
      console.log('[semper] clicking export via:', sel);
      await page.click(sel);
    })(),
  ]);

  const csvText = await download.createReadStream().then(streamToString);
  console.log('[semper] CSV downloaded, bytes:', csvText?.length || 0);

  await browser.close();
  return csvText;
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (d) => chunks.push(Buffer.from(d)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/* ========================= TRANSFORM & PUBLISH ========================= */
async function writeToSheet(csv) {
  const { sheets } = await getGoogleClients();
  const rows = Papa.parse(csv.trim()).data;

  // Clear & write
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: SHEET_TAB,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: SHEET_TAB,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  // Optional: auto-size a handful of columns
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

  return { rows: rows.length, cols: rows[0]?.length || 0 };
}

async function getSheetGid(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find((s) => s.properties.title === tabName);
  return sheet?.properties?.sheetId;
}

async function exportSheetToXlsx() {
  const { drive } = await getGoogleClients();

  // Export Google Sheet → XLSX
  const res = await drive.files.export(
    {
      fileId: SHEET_ID,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    { responseType: 'arraybuffer' }
  );

  // Remove existing file with same name
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
      body: Buffer.from(res.data),
    },
  });
}

/* ========================= PIPELINE ========================= */
let LAST_RUN = null;

async function runPipeline() {
  console.log('[pipeline] starting …');
  const csv = await fetchSemperCsv();
  if (!csv) throw new Error('No CSV downloaded from Semper.');
  const stats = await writeToSheet(csv);
  await exportSheetToXlsx();
  LAST_RUN = { at: new Date().toISOString(), stats };
  console.log('[pipeline] done:', LAST_RUN);
  return LAST_RUN;
}

/* ========================= MCP SERVER (tools) ========================= */
const server = new Server(
  { name: 'semper-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Run now (on-demand)
server.tool(
  new Tool('semper.pullAndPublish', 'Login to Semper, download CSV, write to Google Sheet, export XLSX'),
  async () => {
    const result = await runPipeline();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Last run info
server.tool(
  new Tool('semper.lastRun', 'Show timestamp and row/col counts from last run'),
  async () => ({ content: [{ type: 'text', text: JSON.stringify(LAST_RUN, null, 2) }] })
);

// Start MCP (for ChatGPT Desktop or any MCP client)
server.connect(new StdioServerTransport());

/* ========================= SCHEDULER ========================= */
if (CRON) {
  cron.schedule(CRON, () => {
    runPipeline().catch((err) => console.error('[scheduler] run failed:', err.message));
  });
  console.log('[scheduler] active CRON:', CRON);
}

/* ========================= REMINDER =========================
 * For security, set these in semper-mcp/.env and remove defaults above:
 *  SEMPER_BASE_URL=https://web-prod.semper-services.com/auth
 *  SEMPER_USERNAME=Luba
 *  SEMPER_PASSWORD=0802
 *  SEMPER_VENUE_ID=19205
 *  SEMPER_EXPORT_URL=<<optional_known_export_page>>
 *  SEMPER_DOWNLOAD_TEXT=Export CSV,Download CSV,Export to CSV
 *  SHEET_ID=<<your_sheet_id>>
 *  SHEET_TAB=Raw
 *  DRIVE_FOLDER_ID=<<your_drive_folder_id>>
 *  XLSX_FILENAME=RS Dashboard Data.xlsx
 *  CRON=0 6,14,22 * * *
 * =========================================================== */
