import 'dotenv/config';
import cron from 'node-cron';
import Papa from 'papaparse';
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { Server, Tool } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/* ========================= ENV / CONFIG ========================= */
const {
  SEMPER_BASE_URL,
  SEMPER_USERNAME,
  SEMPER_PASSWORD,
  SHEET_ID,
  SHEET_TAB = 'Raw',
  DRIVE_FOLDER_ID,
  XLSX_FILENAME = 'RS Dashboard Data.xlsx',
  CRON = '0 6,14,22 * * *'
} = process.env;

if (!SEMPER_BASE_URL || !SEMPER_USERNAME || !SEMPER_PASSWORD) {
  console.error('Missing Semper ENV (SEMPER_BASE_URL/USERNAME/PASSWORD)');
}
if (!SHEET_ID) console.error('Missing SHEET_ID');
if (!DRIVE_FOLDER_ID) console.error('Missing DRIVE_FOLDER_ID');

/* ========================= GOOGLE AUTH ========================= */
async function getGoogleClients() {
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  const client = await auth.getClient();
  return {
    sheets: google.sheets({ version: 'v4', auth: client }),
    drive: google.drive({ version: 'v3', auth: client })
  };
}

/* ========================= SEMPER SCRAPER ========================= */
/** Login and download the latest CSV; return CSV string */
async function fetchSemperCsv() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  // 1) Login
  await page.goto(SEMPER_BASE_URL, { waitUntil: 'domcontentloaded' });

  // TODO: Replace these with the real selectors
  await page.fill('input[name="username"]', SEMPER_USERNAME);
  await page.fill('input[name="password"]', SEMPER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');

  // 2) Navigate to the report page and set filters/date-range as needed
  // TODO: Navigate to the right page/menu
  // await page.click('text=Reports');
  // await page.click('text=Your Export');
  // ... choose date range etc.

  // 3) Click export/download
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    // TODO: Replace with the real export button selector
    page.click('button:has-text("Export CSV")')
  ]);

  const csvBuffer = await download.createReadStream().then(streamToString);
  await browser.close();
  return csvBuffer;
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
    range: SHEET_TAB
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: SHEET_TAB,
    valueInputOption: 'RAW',
    requestBody: { values: rows }
  });

  // Optional: autosize – simple approach via batchUpdate
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        autoResizeDimensions: {
          dimensions: { sheetId: await getSheetGid(sheets, SHEET_ID, SHEET_TAB), dimension: 'COLUMNS', startIndex: 0, endIndex: Math.min(30, rows[0]?.length || 10) }
        }
      }]
    }
  });

  return { rows: rows.length, cols: rows[0]?.length || 0 };
}

async function getSheetGid(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === tabName);
  return sheet?.properties?.sheetId;
}

async function exportSheetToXlsx() {
  const { drive } = await getGoogleClients();

  // Export Google Sheet → XLSX
  const res = await drive.files.export(
    {
      fileId: SHEET_ID,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    },
    { responseType: 'arraybuffer' }
  );

  // Remove existing file with same name
  const list = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and name='${XLSX_FILENAME}' and trashed=false`,
    fields: 'files(id,name)'
  });
  for (const f of list.data.files || []) {
    await drive.files.update({ fileId: f.id, requestBody: { trashed: true } });
  }

  // Upload new
  await drive.files.create({
    requestBody: {
      name: XLSX_FILENAME,
      parents: [DRIVE_FOLDER_ID],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from(res.data)
    }
  });
}

/* ========================= PIPELINE ========================= */
let LAST_RUN = null;
async function runPipeline() {
  console.log('[semper-mcp] starting pipeline …');
  const csv = await fetchSemperCsv();
  if (!csv) throw new Error('No CSV downloaded from Semper.');
  const stats = await writeToSheet(csv);
  await exportSheetToXlsx();
  LAST_RUN = { at: new Date().toISOString(), stats };
  console.log('[semper-mcp] done:', LAST_RUN);
  return LAST_RUN;
}

/* ========================= MCP SERVER (tools) ========================= */
const server = new Server(
  { name: 'semper-mcp', version: '1.0.0' },
  {
    capabilities: { tools: {} }
  }
);

// Tool: run now
server.tool(
  new Tool('semper.pullAndPublish', 'Login to Semper, download CSV, write to Google Sheet, export XLSX'),
  async () => {
    const result = await runPipeline();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: last run info
server.tool(
  new Tool('semper.lastRun', 'Show timestamp and row/col counts from last run'),
  async () => ({ content: [{ type: 'text', text: JSON.stringify(LAST_RUN, null, 2) }] })
);

// Start MCP transport (so ChatGPT desktop / MCP client can call it)
server.connect(new StdioServerTransport());

/* ========================= SCHEDULER ========================= */
// Also run automatically 3×/day via cron.
if (CRON) {
  cron.schedule(CRON, () => {
    runPipeline().catch(err => console.error('Scheduled run failed:', err.message));
  });
  console.log('[semper-mcp] scheduler active →', CRON);
}

