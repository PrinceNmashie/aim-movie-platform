> The current UI refresh supersedes interface details below. Use [UPDATE_UI_REFRESH.md](UPDATE_UI_REFRESH.md) for the current package and Render installation. No persistent-data download is required for a code-only update.

# AIM.movie — combined reliability and engagement update

This package includes the earlier account and Runway updates. You do not need to install the older ZIPs first. It updates your existing Python/Flask app on port 8501 or Render; it does not move it to another hosting service.

## What changed

| Area | Included behavior |
| --- | --- |
| Background work | Conversations, creative drafts, character/cast images, scene starting frames, book import/analysis/synthesis, video submission, last-frame preparation, assembly and review-copy preparation run as saved server tasks. |
| Mobile recovery | After the server accepts a task, you can leave Safari. Returning, refreshing or signing back in shows its saved status/results. The server polls saved video job IDs and downloads completed files. |
| Duplicate protection | Retried requests with the same action identifier recover the original task. Identical simultaneous work in the same project also recovers its active task. There is no automatic repeat of an uncertain paid submission. |
| Notifications | Persistent bell/inbox for available reviews, claimed work, review reminders, creator decisions and finished/failed tasks. Read state and preferences persist across devices. |
| Email | Optional encrypted SMTP delivery after the user confirms their email. Instant updates or a daily digest. Delivery failures retry without blocking submissions or decisions. |
| Reviews | Available, claimed-by-me, claimed-by-others and history filters. Claiming clears the available-work alert for other reviewers. Creators never receive staff alerts for their own submissions. |
| Saved and shared creations | Private Saved creations collection, published-post permanent links, phone share sheet where supported, and copy-link fallback. Unpublished posts cannot be viewed through shared links. |
| Discover | Search titles/captions/tags/creators; filter creation type; follow creators and browse Following. The current UI uses a single-video swipe player without technical metadata. |
| Viewer controls | Sound on by default with a speaker toggle, a browser-required tap fallback, and an in-page report form. Counts are labeled signed-in viewers and are recorded after playback begins, not when a card merely enters the screen. |
| Shot planning | No fixed 3–6-shot requirement. Continuous events can stay in one scene. Planning uses target length and the selected model’s limits, favors longer continuous takes and records reasons for cuts. Redundant matching adjacent beats can merge within supported durations. |
| Production checks | Confirmation with a cost estimate and warnings about duration, changed plans, cast references and continuation mode. Invalid model/input combinations are blocked before a paid submission. |
| Image references | Empty Alibaba identity-reference slots can use the saved cast/character sheets. Intentional uploaded/continuation references are retained. A new scene-starting-frame action composes a single frame using saved cast references for image-to-video workflows. |
| Interface | Safe rendering of basic Markdown in MIA replies, expandable scene/shot editors, task progress and concise member views. Operational diagnostics remain admin-only. |
| Sponsor evidence | Admin-only Creative history → Export sponsor test log (CSV). Includes newly recorded API request IDs/returned usage, task timings, saved job settings, prompts, references and estimates. Review decisions and provider-confirmed charges can be entered in the blank evidence columns. |
| Earlier updates retained | All 25 configured Runway models, direct Alibaba Wan 3.0 output up to 30 seconds where supported, profile-picture editing, private liked videos, account settings/deletion and administrator role controls. |

## Update your local app in VS Code

1. Stop the app in its terminal with **Control+C**. Keep a backup of your existing project and persistent data.
2. Extract `AIM_movie_Complete_Update.zip`.
3. Copy **all the runtime files and the complete `static` and `templates` folders** from the extracted update into your existing app folder, merging/replacing code files. Keep folder names lowercase. Use `UPDATE_FILE_LIST.txt` to check the file list.
4. Keep your existing `.env`, data folder, database files and generated media. The ZIP contains no real credentials or accounts. Do not replace your data directory or start with an empty one.
5. In your existing Python environment, run:

   ```bash
   python -m pip install -r requirements.txt
   python app.py --port 8501
   ```

   Use `python3` if that is your normal Python command. No new production dependency is required by this update.
6. Open `http://127.0.0.1:8501` and hard-refresh with **Command+Shift+R**. Existing accounts remain. New tables are added automatically.

`AIM_movie_Creator_Platform.zip` is the full source, including tests and examples. For an existing installation, the smaller combined update is sufficient.

## Update Render

Upload the same complete file set to the existing repository, preserving both folders. Keep your `wsgi.py`, Render start command, Gunicorn/hosting additions to requirements, persistent disk mount, `AIM_DATA_DIR`, API keys, cookie settings and session secret. Do not reset databases. Deploy only after uploading all files, then hard-refresh.

The embedded worker is enabled by default. You may explicitly set `AIM_EMBEDDED_WORKER=1`. No Redis or additional paid worker service is required for this beta. Use an always-running server for work to continue while users are away. Closing a browser is supported; shutting down/suspending your local laptop or sleeping/stopping the hosting service stops its Python process.

If you still have the retired Runpod integration, remove `runpod_client.py` and `workflow.json` from the running app, and retire its unused environment variables. Stop unused external Runpod resources in that service separately. Previously downloaded clips remain usable.

## Optional email setup

The notification bell works immediately without email configuration. To offer email alerts, configure your email service’s SMTP credentials in local `.env` or Render Environment:

```dotenv
AIM_PUBLIC_URL=https://your-existing-site.example
AIM_SMTP_HOST=smtp.your-email-service.example
AIM_SMTP_PORT=587
AIM_SMTP_SECURITY=starttls
AIM_SMTP_USERNAME=your_smtp_username
AIM_SMTP_PASSWORD=your_smtp_password
AIM_EMAIL_FROM=AIM.movie <updates@your-verified-domain.example>
```

Use your actual public HTTPS address and a sender approved by your email service. For implicit TLS, use `AIM_SMTP_SECURITY=ssl` and its port, commonly 465. Unencrypted SMTP is not supported. Do not commit secrets to GitHub.

Users open **Account → Account settings → Notifications → Confirm my email**. The confirmation link expires in one hour and can be used once. Then they can enable email and choose its frequency. Daily digests are scheduled for the next UTC day boundary. Claimed-review reminders begin after 24 hours and are deduplicated by day. Notifications contain short generic messages and links requiring sign-in; private scripts, media and staff notes are not emailed.

## Tasks and recovery

- Use **Account → Tasks** to see work from all your projects. Studio pages show a banner for their current project. Work can finish after signing out; signing in again restores access.
- Server task status does not depend on client polling. Video status polling uses saved provider IDs and does not start another generation.
- Book analysis saves every completed excerpt. Pause takes effect after the current excerpt. Start/Resume continues from unfinished excerpts within the saved budget.
- While a long operation owns a project, conflicting edits are blocked. You can browse elsewhere or work in another project.
- Queued work survives a process restart. If the server stops during an in-flight operation and its lease expires, it is marked interrupted rather than repeated automatically: the provider might already have billed it. Review saved outputs/provider usage before choosing to try again. Saved video IDs are recoverable and their status checks resume.
- Task acceptance is the boundary: an upload must finish reaching the server before leaving the page. A task cannot run if it was never accepted.
- Account deletion waits for active tasks to finish. Pausable book work can be paused first.

## Sponsor cost testing

Create a separate named project for each controlled test batch. Fix the model, duration, quality, audio, reference images and prompt before testing. Save the deployed commit/package version and the actual output files.

After the batch, an administrator can export **Creative history → Export sponsor test log (CSV)**. New OpenAI text/image/transcription/book calls record IDs, timestamps and returned usage when available. Failed or uncertain calls remain in the evidence. Video rows contain estimates and saved provider metadata; task rows provide app timing and are not additional billable requests.

Reconcile against provider exports. The ledger does not reconstruct historical calls, provide complete realtime voice metering, or claim invoice-level costs. Fill reviewer acceptance, confirmed charges and billing-evidence columns from the actual evidence. Customer subscriptions, checkout and sellable credit packs are not activated; final retail prices still depend on your measured costs.

## Quick device check after installing

1. Start a script/image task, leave the browser, return and check the saved result. Repeat with a video once you deliberately enable paid calls.
2. Refresh or retry after a connection loss; confirm the original task/job is recovered rather than duplicated.
3. Submit from a member account. Check a separate reviewer’s bell/inbox. Have two reviewers try to claim it; only one should succeed. Save a decision and check the creator’s notification.
4. Save a published post on your phone and find it from another device signed into the same account.
5. Share its permanent link with a signed-out browser. Unpublish it and confirm the link and media no longer play publicly.
6. Check settings, compact editors, video framing and notification menus on a narrow phone screen.

Paid API generations and live email delivery were not run during implementation. Visual layout and actual Safari suspension behavior require this device check; automated request-loss and worker-completion tests are included.
