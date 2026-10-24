const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { seatRecord, searchUrl, loadConfig, pendingRecipients } = require('../asu_check_once');

function sample(n, cap, enrolled, status='O') {
  return {classes:[{CLAS:{CLASSNBR:String(n),SUBJECT:'EEE',CATALOGNBR:'202',
    ENRLCAP:String(cap),ENRLTOT:String(enrolled),ENRLSTAT:status,INSTRUCTORSLIST:['Professor']}}]};
}
test('watchlist selects 15780', () => {
  const { active } = loadConfig();
  assert.equal(active.length,1);
  assert.equal(active[0].classNumber,'15780');
  assert.equal(active[0].recipients[0],'me');
  assert.match(searchUrl('15780','2271'),/classNbr=15780/);
  assert.match(searchUrl('15780','2271'),/term=2271/);
});
test('open versus closed detection', () => {
  assert.equal(seatRecord(sample('15780',60,59),'15780').available, true);
  assert.equal(seatRecord(sample('15780',60,60),'15780').available, false);
  assert.equal(seatRecord(sample('15780',60,59,'C'),'15780').available, false);
});
test('missing class throws', () => {
  assert.throws(()=>seatRecord(sample('88888',60,59),'15780'),/did not include/);
});
test('alerts only missing aliases and resets when full', () => {
  const opened = {available:true};
  assert.deepEqual(pendingRecipients({available:false,notifiedRecipients:['me']},opened,['me','friend']),['me','friend']);
  assert.deepEqual(pendingRecipients({available:true,notifiedRecipients:['me']},opened,['me','friend']),['friend']);
  assert.deepEqual(pendingRecipients({available:true,notifiedRecipients:['me']},{available:false},['me']),[]);
});
