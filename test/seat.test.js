const test = require('node:test');
const assert = require('node:assert/strict');
const { seatRecord, searchUrl } = require('../asu_check_once');

const sample = (n, cap, enrolled, status='O') => ({ classes: [
  { CLAS: { CLASSNBR: String(n), SUBJECT: 'EEE', CATALOGNBR: '202', ENRLCAP: String(cap), ENRLTOT: String(enrolled), ENRLSTAT: status, INSTRUCTORSLIST: ['Test Instructor'] } }
] });

test('queries target class 15780 in spring 2027', () => {
  assert.match(searchUrl(), /classNbr=15780/);
  assert.match(searchUrl(), /term=2271/);
});
test('detects opening when enrollment status is open', () => {
  let r = seatRecord(sample(15780, 100, 99));
  assert.equal(r.free, 1);
  assert.equal(r.available, true);
  r = seatRecord(sample(15780, 100, 100));
  assert.equal(r.available, false);
  r = seatRecord(sample(15780, 100, 99, 'C'));
  assert.equal(r.available, false);
});
test('missing class is never treated as having a seat', () => {
  assert.throws(() => seatRecord(sample(88888, 100, 98)), /did not include class/);
});
