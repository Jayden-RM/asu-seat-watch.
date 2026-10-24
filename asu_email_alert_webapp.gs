/** OPTIONAL companion to asu_seat_monitor.js
 *  Google Apps Script -> Deploy -> New deployment -> Web app.
 *  Execute as: Me; Who has access: Anyone (needed for the local Node sender).
 *  Set DESTINATION_EMAIL and SHARED_SECRET to your values before deployment.
 *  Keep the secret private and never commit it to public Git repositories.
 */
const DESTINATION_EMAIL = 'nicolezhu1212@gmail.com';
const SHARED_SECRET = '123456789123456789123456789123456789';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    if (!SHARED_SECRET || SHARED_SECRET.startsWith('REPLACE_') || data.token !== SHARED_SECRET) {
      return ContentService.createTextOutput('Unauthorized');
    }
    if (!DESTINATION_EMAIL.includes('@') || DESTINATION_EMAIL.startsWith('REPLACE_')) {
      return ContentService.createTextOutput('Email not configured');
    }
    const subject = String(data.subject || '').slice(0, 180);
    const message = String(data.message || '').slice(0, 10000);
    if (!subject || !message) return ContentService.createTextOutput('Missing content');
    MailApp.sendEmail(DESTINATION_EMAIL, subject, message);
    return ContentService.createTextOutput('OK');
  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput('Error');
  }
}
