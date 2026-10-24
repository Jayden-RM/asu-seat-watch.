# ASU class #15780 — free cloud monitor

This project checks Spring 2027 ASU class number **15780** using your original Playwright browser/API-response method. It is preconfigured for a **GitHub Actions run approximately every 5 minutes**, not every minute. Scheduled jobs may be delayed or occasionally skipped. It needs to be installed in YOUR GitHub account before it starts running. It cannot enroll you automatically.

## Create a free monitor (computer may be off)

1. Sign into [GitHub](https://github.com/) and create a **PUBLIC** repository named `asu-seat-watch`. Public repositories use the standard GitHub-hosted runner without Actions minute charges. Do not use a private repository for this every-5-minute setup without checking its monthly Actions minutes. The source code and nonprivate seat status are public; secrets go into GitHub Actions Secrets.
2. Upload the **contents** of this folder to the root of the repository, including hidden `.github/workflows/check-seats.yml`. The simplest way to preserve `.github` is to unzip and use Git, GitHub Desktop, or a Git client. Commit to the repository's **default branch**.
3. **Choose an alert method.** For Discord, create a webhook in the desired Discord channel and go to GitHub repo **Settings → Secrets and variables → Actions → New repository secret**. Make a secret named `DISCORD_WEBHOOK_URL` containing the webhook URL. Never put the webhook in the source files or a commit.
   **Email option:** Create a Google Apps Script project from `asu_email_alert_webapp.gs`. Set destination email and a long random shared secret; deploy as a Web app (Execute as: Me, Access: Anyone). In GitHub Actions Secrets, set `GAS_EMAIL_URL` to `/exec` URL and `GAS_SHARED_SECRET` to the same shared secret. The web app is protected by the shared secret; keep it private. You can configure one or both alert methods.
4. Under your repo **Actions**, open **Monitor ASU class 15780** and click **Run workflow** to test. Check the job logs. If you see `did not include class #15780`, double-check Spring 2027 is the right semester and the class actually appears on ASU's site. If you see a 401/403/429, stop; ASU is restricting the access, and this project does not bypass that.
5. After a successful run, GitHub's `schedule` checks approximately every 5 minutes even if your computer is shut down. GitHub may delay jobs or automatically disable scheduled workflows after inactivity; check Actions occasionally.

## How the alerts work

- `ENRLCAP - ENRLTOT` determines open seats, combined with `ENRLSTAT` (closed courses don't alert).
- Sends one notification on first detection of an open seat, or when a class goes from closed to open.
- Persists status in `state/asu_seat_state.json` on GitHub, so new Actions jobs don't keep alerting for the same seat.
- If a notification fails, it does not mark the opening as alerted, so the next check retries.
- The status file updates when availability/count/status changes and about once every 30 days for long-term repo activity.
- Reserved seats may not be open to you; an alert does not guarantee you can register.

## Testing locally (optional)

Run `npm ci`, `npx playwright install chromium`, `npm test`, and `node asu_check_once.js` to make a live check.

## Limitations

- **Not yet verified live for class #15780.** The source file you uploaded showed the class-search API response format but did not contain this class.
- 5 minutes is GitHub's minimum schedule interval, not 1 minute.
- ASU's class search is a dynamically loaded webpage; the underlying API may require browser-session authentication. A plain Apps Script `UrlFetchApp` cannot be assumed to work. Browser access may also change or be blocked.
- Confirm ASU's acceptable-use rules and rate limits; don't bypass access restrictions.
- Public GitHub repos expose source code and nonprivate seat counts. Notification credentials MUST remain in repository Actions Secrets.

**If exactly one minute is necessary**, use the other ZIP (`ASU_Class_15780_Cloud_Seat_Monitor.zip`) on an Oracle Cloud **Always Free** VM. Oracle may require payment-card verification; eligible Always Free shapes may be out of capacity. Ensure you choose *Always Free-eligible* resources and remain under the quotas.
