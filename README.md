# ASU class seat monitor — multiple classes / email aliases

This is an upgraded version of your working GitHub Actions + cron-job.org checker.

## QUICK SETUP — changes you make

1. **Update the repository**: extract this ZIP and upload/replace the contents in your GitHub repository, preserving the `.github/workflows` directory. Alternatively edit those workflow files directly in GitHub. Keep `check-seats.yml` and `test-email.yml` as separate files. **Do not upload old `asu_email_alert_webapp.gs` containing your private email or secret.** This ZIP includes a sanitized version.
2. Edit **`watchlist.json`** in GitHub whenever you want to change which classes are monitored.
3. Replace your Google Apps Script Web App's code with **`asu_email_alert_webapp.gs`** from this ZIP.
4. In Apps Script **Project Settings > Script properties** set:
   - `GAS_SHARED_SECRET`: a NEW unpredictable string of at least 32 characters.
   - `RECIPIENT_EMAILS_JSON`: valid JSON mapping nicknames to private emails, for example `{"me":"your-address@example.com","friend":"someone@example.com"}`.
5. In Apps Script **Deploy > Manage deployments > Edit > New version > Deploy** to publish the update. Keep **Execute as Me** and **Who has access: Anyone**. The shared secret and fixed allowlist protect sending.
6. In GitHub **Settings > Secrets and variables > Actions** keep `GAS_EMAIL_URL` set to the Apps Script Web App `/exec` URL, and update `GAS_SHARED_SECRET` to the exact new script property value.
7. Run **Actions > Test ASU Email** manually; verify the `me` email arrives. Then manually run **Monitor ASU seat watchlist** to confirm seat lookups. Your existing **cron-job.org** API dispatch URL still works, because the file name `check-seats.yml` stays unchanged; its recurring trigger schedule stays with cron-job.org.

**IMPORTANT:** Revoke and replace the GitHub personal access token that was previously shown in chat/screenshots. Enter the replacement only in cron-job.org's private Authorization header. Do not paste credentials into issues, chat, screenshots or public repository files.

## Editing watchlist.json

```json
{
  "defaultTerm": "2271",
  "termNames": { "2271": "Spring 2027", "2277": "Fall 2027" },
  "classes": [
    { "classNumber": "15780", "term": "2271", "enabled": true, "recipients": ["me"] },
    { "classNumber": "26825", "term": "2271", "enabled": false, "recipients": ["me", "friend"] }
  ]
}
```

- Add as many rows as you need, up to 15 **enabled** class sections. Each can have one or multiple recipient aliases; to watch different terms, set `term` on that class.
- `enabled: false` pauses a class without deleting it.
- `recipients` must match aliases in `RECIPIENT_EMAILS_JSON` in Apps Script. Real email addresses never belong in `watchlist.json`, because your repository is public.
- Class #15780 (EEE 202) is **enabled** by default. Class #26825 is **disabled** as an editing example.
- Adding a new recipient alias to a currently open class will notify the new alias at the next successful check.
- It sends **one email per alias per opening**; when a section fills, its alert flag resets so it can notify again on the next opening.
- If one recipient's email fails, other successful sends are saved and the failed recipient is retried on the next check. GitHub Actions shows a failed run until the error is resolved.

## Notes

- cron-job.org attempts to dispatch your GitHub Action every five minutes. GitHub startup, execution, and ASU access can still be delayed or blocked. Polling must comply with ASU rules; don't increase frequency if blocked.
- Each enabled class generates its own ASU page/API request. Long lists can extend execution time. Google Mail daily quotas still apply.
- Google Apps Script testEmail() sends a test to all configured aliases, but the GitHub Test ASU Email workflow sends only to `me`.
- `state/asu_seat_state.json` retains your last known EEE 202 full/closed status from the working test; the other bogus class-key from the uploaded ZIP has been discarded.
- The test workflow has no automatic schedule; only the monitor is dispatched by cron-job.org.
- The Apps Script allows webhook requests by anyone who knows the random shared secret; rotate it if leaked. You can remove the old hardcoded GAS file's Git history using repository-history tools if privacy is important; deleting it in a new commit does not remove it from existing history.

## Troubleshooting

- **HTTP 204 from cron-job.org**: GitHub accepted workflow dispatch, not proof the job completed. Check GitHub Actions for the seat-check result.
- **`Unknown recipient alias`**: the nickname is missing from `RECIPIENT_EMAILS_JSON` in Apps Script.
- **`Unauthorized`**: `GAS_SHARED_SECRET` disagrees or is too short; redeploy latest Apps Script.
- **`ASU response did not include class`**: verify the five-digit class number and term.
- **Missing emails**: check GitHub Actions logs, Apps Script executions, Gmail quota, and junk folders.
