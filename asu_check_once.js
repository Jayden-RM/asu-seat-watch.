'use strict';
// ASU seat monitor: multiple class numbers and per-class private recipient aliases.
// cron-job.org dispatches the existing GitHub Actions workflow. No credentials here.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const ASU_URL = 'https://catalog.apps.asu.edu/catalog/classes';
const CONFIG_FILE = path.join(ROOT, 'watchlist.json');
const STATE_FILE = path.join(ROOT, 'state', 'asu_seat_state.json');
const ERROR_STATUS = new Set([401, 403, 429]);

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (!Array.isArray(cfg.classes) || !cfg.classes.length) throw Error('watchlist.json must have a nonempty classes array');
  const active = cfg.classes.filter(c => c.enabled !== false);
  const seen = new Set();
  for (const c of active) {
    c.classNumber = String(c.classNumber || '').trim();
    c.term = String(c.term || cfg.defaultTerm || '2271').trim();
    if (!/^\d{5,6}$/.test(c.classNumber)) throw Error(`Invalid class number: ${c.classNumber}`);
    if (!/^\d{4}$/.test(c.term)) throw Error(`Invalid term for #${c.classNumber}`);
    const key = `${c.term}|${c.classNumber}`;
    if (seen.has(key)) throw Error(`Duplicate monitored section ${key}`);
    seen.add(key);
    if (!Array.isArray(c.recipients) || !c.recipients.length) throw Error(`#${c.classNumber}: recipients must contain one or more aliases`);
    c.recipients = [...new Set(c.recipients.map(x => String(x).trim()))];
    if (c.recipients.some(x => !/^[a-z][a-z0-9_-]{0,39}$/i.test(x))) throw Error(`#${c.classNumber}: invalid recipient alias`);
  }
  if (active.length > 15) throw Error('Maximum of 15 monitored sections per run to limit ASU requests');
  return { active, termNames: cfg.termNames || {} };
}

function searchUrl(classNumber, term) {
  const params = new URLSearchParams({
    advanced: 'true', campusOrOnlineSelection: 'A', honors: 'F',
    promod: 'F', searchType: 'all', term: String(term), classNbr: String(classNumber)
  });
  return `${ASU_URL}/classlist?${params}`;
}

function seatRecord(json, classNumber) {
  if (!json || !Array.isArray(json.classes)) throw Error('Expected classes[] in ASU response');
  const item = json.classes.find(x => String(x?.CLAS?.CLASSNBR || x?.CLAS?.id || '').trim() === String(classNumber));
  if (!item) throw Error(`ASU response did not include class #${classNumber}`);
  const c = item.CLAS;
  const cap = Number(c.ENRLCAP ?? item.seatInfo?.ENRL_CAP);
  const enrolled = Number(c.ENRLTOT ?? item.seatInfo?.ENRL_TOT);
  if (!Number.isFinite(cap) || !Number.isFinite(enrolled) || cap <= 0 || enrolled < 0)
    throw Error(`Invalid enrollment data for #${classNumber}`);
  const status = String(c.ENRLSTAT || '').toUpperCase();
  const free = cap - enrolled;
  return {
    classNumber: String(classNumber),
    course: [c.SUBJECT, c.CATALOGNBR].filter(Boolean).join(' ') || 'Unknown course',
    instructor: Array.isArray(c.INSTRUCTORSLIST) ? c.INSTRUCTORSLIST.join(', ') || 'TBA' : 'TBA',
    section: String(c.CLASSSECTION || ''),
    cap, enrolled, free, status,
    reserved: String(c.HASACTIVERESERVEDSEATS || '').toUpperCase() === 'Y',
    available: free > 0 && (status === 'O' || status === '')
  };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, STATE_FILE);
}
function notificationText(record, term) {
  return `ASU SEAT ALERT — ${record.course} (class #${record.classNumber})\n` +
    `Term: ${term}\nAvailable seats: ${record.free} of ${record.cap}\n` +
    `Instructor: ${record.instructor}\n` +
    (record.reserved ? 'Warning: Some seats may be reserved.\n' : '') +
    `Check enrollment: ${ASU_URL}\n` +
    'An apparent opening is not a guaranteed enrollable seat.';
}

async function sendEmail(alias, record, term) {
  const url = (process.env.GAS_EMAIL_URL || '').trim();
  const token = (process.env.GAS_SHARED_SECRET || '').trim();
  if (!url || !token) throw Error('GitHub secrets GAS_EMAIL_URL and GAS_SHARED_SECRET are required');
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, recipient: alias,
      subject: `ASU seat open: ${record.course} #${record.classNumber}`,
      message: notificationText(record, term) }),
    signal: AbortSignal.timeout(15000)
  });
  const body = (await response.text()).trim();
  if (!response.ok || body !== 'OK') throw Error(`Email to alias "${alias}" failed: HTTP ${response.status}, ${body.slice(0, 80)}`);
}

async function sendDiscord(record, term) {
  const url = (process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!url) return false;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: notificationText(record, term).slice(0, 1900) }),
    signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Discord HTTP ${response.status}`);
  return true;
}

async function readAsu(browser, classNumber, term) {
  const page = await browser.newPage();
  try {
    const responsePromise = page.waitForResponse(
      r => r.url().includes('/catalog-microservices/api/v1/search/classes') && r.request().method() === 'GET',
      { timeout: 45000 }
    );
    await page.goto(searchUrl(classNumber, term), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const response = await responsePromise;
    if (ERROR_STATUS.has(response.status())) throw Error(`ASU rejected HTTP ${response.status()}; stop polling if ASU blocks access`);
    if (!response.ok()) throw Error(`ASU returned HTTP ${response.status()}`);
    return await response.json();
  } finally { await page.close(); }
}

// Pure transition logic: an alert is delivered once per alias while a section stays open.
// If it fills, remembered recipients reset, permitting an alert when it reopens.
function pendingRecipients(previous, record, recipients) {
  if (!record.available) return [];
  const already = previous && previous.available ? (previous.notifiedRecipients || []) : [];
  return recipients.filter(alias => !already.includes(alias));
}

async function processClass(browser, c, termNames, state) {
  const key = `${c.term}|${c.classNumber}`;
  const record = seatRecord(await readAsu(browser, c.classNumber, c.term), c.classNumber);
  const previous = state[key] || null;
  const termLabel = termNames[c.term] || c.term;
  console.log(`${new Date().toISOString()}: ${record.course} #${c.classNumber}: ${record.free}/${record.cap} open; status=${record.status}; available=${record.available}`);
  const recipients = record.available && previous?.available ? [...(previous.notifiedRecipients || [])] : [];
  let discordSent = Boolean(record.available && previous?.available && previous?.discordSent);
  const failures = [];
  for (const alias of pendingRecipients(previous, record, c.recipients)) {
    try {
      await sendEmail(alias, record, termLabel);
      recipients.push(alias);
      console.log(`Email alert accepted for ${record.course} #${c.classNumber} -> ${alias}`);
    } catch (err) {
      failures.push(err.message);
      console.error(`Notification problem for #${c.classNumber}/${alias}: ${err.message}`);
    }
  }
  if (record.available && !discordSent && process.env.DISCORD_WEBHOOK_URL?.trim()) {
    try { discordSent = await sendDiscord(record, termLabel); }
    catch (err) { failures.push(err.message); }
  }
  const next = {
    available: record.available, free: record.free, cap: record.cap,
    status: record.status, reserved: record.reserved, course: record.course,
    notifiedRecipients: record.available ? [...new Set(recipients)] : [],
    discordSent: record.available ? discordSent : false
  };
  // Save successful deliveries even if another recipient failed. Failed ones retry next run.
  const changed = JSON.stringify(previous) !== JSON.stringify(next);
  state[key] = next;
  const heartbeat = Date.now() - Date.parse(state.lastHeartbeat || '1970-01-01') > 30 * 86400000;
  if (changed || heartbeat) {
    state.lastHeartbeat = new Date().toISOString();
    saveState(state);
    console.log(`Saved state for ${key}`);
  }
  if (failures.length) throw Error(failures.join('; '));
  return record;
}

async function main() {
  const { active, termNames } = loadConfig();
  if (!active.length) { console.log('No enabled classes in watchlist.json'); return; }
  const state = loadState();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const c of active) {
      try { await processClass(browser, c, termNames, state); }
      catch (err) { console.error(`ERROR ${c.term}|${c.classNumber}: ${err.message}`); failures.push(`${c.classNumber}: ${err.message}`); }
    }
  } finally { await browser.close(); }
  if (failures.length) throw Error(`${failures.length} class(es) failed: ${failures.join(' | ')}`);
  console.log(`Finished checking ${active.length} class(es).`);
}

if (require.main === module) main().catch(err => { console.error(err.stack || String(err)); process.exitCode = 1; });
module.exports = { loadConfig, searchUrl, seatRecord, pendingRecipients, notificationText, main };
