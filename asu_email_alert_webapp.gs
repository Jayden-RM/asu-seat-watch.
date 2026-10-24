/** ASU seat alerts - deploy as Apps Script Web App.
 * Execute as: Me; Access: Anyone.
 * In Project Settings > Script properties, set:
 *  GAS_SHARED_SECRET = same random secret as GitHub's GAS_SHARED_SECRET
 *  RECIPIENT_EMAILS_JSON = {"me":"you@example.com","friend":"friend@example.com"}
 * This allowlist prevents a caller from choosing arbitrary recipient email addresses.
 * Never put email addresses or secrets in a PUBLIC GitHub repository.
 */
function doPost(e) {
  try {
    const p = PropertiesService.getScriptProperties();
    const secret = p.getProperty('GAS_SHARED_SECRET');
    const aliases = JSON.parse(p.getProperty('RECIPIENT_EMAILS_JSON') || '{}');
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!secret || secret.length < 32 || data.token !== secret) {
      return ContentService.createTextOutput('Unauthorized');
    }
    const alias = String(data.recipient || '');
    if (!/^[a-z][a-z0-9_-]{0,39}$/i.test(alias) || !Object.prototype.hasOwnProperty.call(aliases, alias)) {
      return ContentService.createTextOutput('Unknown recipient alias');
    }
    const destination = String(aliases[alias]);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      return ContentService.createTextOutput('Invalid recipient email');
    }
    const subject = String(data.subject || '').slice(0, 180);
    const message = String(data.message || '').slice(0, 10000);
    if (!subject || !message) return ContentService.createTextOutput('Missing content');
    MailApp.sendEmail(destination, subject, message);
    return ContentService.createTextOutput('OK');
  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput('Error');
  }
}

function testEmail() {
  const aliases = JSON.parse(PropertiesService.getScriptProperties().getProperty('RECIPIENT_EMAILS_JSON') || '{}');
  for (const [alias, email] of Object.entries(aliases)) {
    MailApp.sendEmail(email, 'TEST: ASU seat monitor', 'Email alias "' + alias + '" is configured.');
  }
}
