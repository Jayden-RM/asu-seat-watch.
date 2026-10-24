'use strict';
// Checks one Spring 2027 class using the same public ASU class-search page
// and captured JSON response as the user's existing Playwright scraper.
// Does not log in, reserve seats, or bypass blocked requests.
const fs = require('node:fs');
const path = require('node:path');

const CLASS_NUMBER = '26825';
const TERM = '2271';
const TERM_NAME = 'Spring 2027';
const STATE_FILE = path.join(__dirname, 'state', 'asu_seat_state.json');
const ASU_URL = 'https://catalog.apps.asu.edu/catalog/classes';

function searchUrl() {
  const params = new URLSearchParams({
    advanced: 'true', campusOrOnlineSelection: 'A', honors: 'F',
    promod: 'F', searchType: 'all', term: TERM, classNbr: CLASS_NUMBER
  });
  return `${ASU_URL}/classlist?${params}`;
}

function seatRecord(json, classNumber = CLASS_NUMBER) {
  if (!json || !Array.isArray(json.classes)) throw Error('Expected classes[] in ASU API response');
  const entry = json.classes.find(item => String(item?.CLAS?.CLASSNBR || item?.CLAS?.id || '').trim() === String(classNumber));
  if (!entry) throw Error(`ASU response did not include class #${classNumber}. Verify term/class number.`);
  const c = entry.CLAS;
  const cap = Number(c.ENRLCAP ?? entry.seatInfo?.ENRL_CAP);
  const enrolled = Number(c.ENRLTOT ?? entry.seatInfo?.ENRL_TOT);
  if (!Number.isFinite(cap) || !Number.isFinite(enrolled) || cap <= 0 || enrolled < 0) {
    throw Error(`Missing/invalid capacity or enrollment for class #${classNumber}`);
  }
  const status = String(c.ENRLSTAT || '').toUpperCase();
  const free = cap - enrolled;
  return {
    classNumber: String(classNumber),
    course: [c.SUBJECT, c.CATALOGNBR].filter(Boolean).join(' ') || 'Unknown course',
    section: String(c.CLASSSECTION || ''),
    instructor: Array.isArray(c.INSTRUCTORSLIST) ? c.INSTRUCTORSLIST.join(', ') || 'TBA' : 'TBA',
    cap, enrolled, free, status,
    reserved: String(c.HASACTIVERESERVEDSEATS || '') === 'Y',
    available: free > 0 && (status === 'O' || status === '')
  };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(temp, STATE_FILE);
}

function notificationText(r) {
  return `ASU SEAT ALERT — ${r.course} (class #${r.classNumber})\n` +
    `Term: ${TERM_NAME}\n` +
    `Available seats: ${r.free} of ${r.cap}\n` +
    `Instructor: ${r.instructor}\n` +
    (r.reserved ? 'Warning: Some seats may be reserved.\n' : '') +
    `Check and enroll promptly: ${ASU_URL}\n` +
    'A reported opening is not a guaranteed available enrollment seat.';
}

async function sendAlert(r) {
  const discord = process.env.DISCORD_WEBHOOK_URL?.trim();
  const gasUrl = process.env.GAS_EMAIL_URL?.trim();
  const secret = process.env.GAS_SHARED_SECRET?.trim();
  if (!discord && !gasUrl) {
    throw Error('An opening was detected, but no notifications are configured. Add DISCORD_WEBHOOK_URL or GAS_EMAIL_URL secret in GitHub settings.');
  }
  const message = notificationText(r);
  if (discord) {
    const res = await fetch(discord, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message.slice(0, 1900) }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw Error(`Discord notification failed: HTTP ${res.status}`);
  }
  if (gasUrl) {
    if (!secret) throw Error('Missing GAS_SHARED_SECRET GitHub secret');
    const res = await fetch(gasUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secret, subject: `ASU class #${r.classNumber} has a seat`, message }),
      signal: AbortSignal.timeout(15000)
    });
    const body = (await res.text()).trim();
    if (!res.ok || body !== 'OK') throw Error(`Google Apps Script email failed: HTTP ${res.status}, ${body.slice(0, 80)}`);
  }
}

async function readAsu() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const responsePromise = page.waitForResponse(
      r => r.url().includes('/catalog-microservices/api/v1/search/classes') && r.request().method() === 'GET',
      { timeout: 45000 }
    );
    await page.goto(searchUrl(), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const res = await responsePromise;
    if ([401, 403, 429].includes(res.status())) throw Error(`ASU rejected request HTTP ${res.status()}; do not bypass or increase polling`);
    if (!res.ok()) throw Error(`ASU class search returned HTTP ${res.status()}`);
    return await res.json();
  } finally { await browser.close(); }
}

async function checkOnce({ sampleJson } = {}) {
  const raw = sampleJson || await readAsu();
  const current = seatRecord(raw);
  console.log(`${new Date().toISOString()}: ${current.course} #${CLASS_NUMBER}: ${current.free} open / ${current.cap} capacity; status=${current.status}; available=${current.available}`);
  const state = loadState();
  const key = `${TERM}|${CLASS_NUMBER}`;
  const prev = state[key];
  const opening = current.available && (!prev || prev.available === false);
  // When testing with a sample, never notify or mutate the saved state.
  if (sampleJson) {
    console.log(`OFFLINE TEST: would alert=${opening}; sample input (not live)`);
    return;
  }
  if (opening) {
    await sendAlert(current);  // If alert fails, preserve previous state so next run retries.
    console.log('Seat opening alert sent.');
  }
  const updated = {
    available: current.available,
    free: current.free,
    cap: current.cap,
    status: current.status,
    reserved: current.reserved,
    course: current.course
  };
  const lastChange = JSON.stringify(updated) !== JSON.stringify({
    available: prev?.available, free: prev?.free, cap: prev?.cap,
    status: prev?.status, reserved: prev?.reserved, course: prev?.course
  });
  // Occasional heartbeat keeps long-lived scheduled workflows from becoming dormant.
  const heartbeatExpired = Date.now() - Date.parse(state.lastHeartbeat || '1970-01-01') > 30 * 86400000;
  if (lastChange || heartbeatExpired) {
    state[key] = updated;
    state.lastHeartbeat = new Date().toISOString();
    saveState(state);
    console.log('Saved current seat status.');
  } else {
    console.log('Status unchanged; no state commit needed.');
  }
}

if (require.main === module) {
  const sampleIndex = process.argv.indexOf('--sample');
  const sampleJson = sampleIndex >= 0
    ? JSON.parse(fs.readFileSync(process.argv[sampleIndex + 1], 'utf8')) : undefined;
  checkOnce({ sampleJson }).catch(err => { console.error(err.stack || String(err)); process.exitCode = 1; });
}
module.exports = { seatRecord, searchUrl, notificationText, checkOnce };
