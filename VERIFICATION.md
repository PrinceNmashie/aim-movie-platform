# Verification — AIM.movie combined update, October 29, 2026

## Automated checks

- 220 distinct Python tests verified: 219 passed in the full regression run; the final queued multipart-review regression was added afterward and passed with all 22 background/engagement tests. The targeted suite was rerun after the upload-body fix and preference validation change.
- The Python suite covers retained provider catalog requests, model limits, 30-second Alibaba requests, errors/redaction, profiles, private likes, accounts/roles/deletion, book input, clips/continuation/assembly, review/publication, plus the new cases below.
- New queue tests verify persisted work after sign-out, one submission for duplicate IDs, semantic multipart deduplication, different-payload rejection, private task access, workspace validation, paid gate enforcement, concurrent worker claims, no automatic replay of interrupted paid work, recovery/polling of saved provider IDs, image persistence, background book import/analysis/pause, and queued review uploads retaining their media after authorization.
- New engagement tests verify reviewer self-exclusion, claim/decision notifications, owner-only read state and preferences, notification deduplication, email confirmation token use, retryable SMTP failures, bookmarks/follows, signed-out public links, unpublish/media access, and private unavailable-bookmark stubs.
- New production/evidence tests verify continuity planning and merging only matching adjacent beats, preflight without provider submission, automatic identity references, returned/failed request evidence, admin-only CSV export and formula-safe CSV cells.
- Existing frontend contract checks passed for studio/account/feed/review/profile templates, member/admin visibility, all catalog models and pricing controls, review handoff, keyboard behavior and voice-controller doubles. New shared scripts and page routes are loaded by the contract harness.
- JavaScript syntax checks passed for the changed application, portal, platform, engagement and portal-extras scripts. Python compilation passed for the changed server modules.

## Full-page DOM and HTTP checks

Nine flows passed against an isolated running Flask server with synthetic QA accounts and motion-graphic fixtures: guest feed/search, public post page, bookmark saving, saved-list removal, notification settings, safe basic Markdown, compact shot editing, an asynchronous last-frame capture continuing after its DOM window closed, and its saved Tasks result. These checks load and execute the actual page scripts and use the actual HTTP endpoints. They use JSDOM, not a visual browser rendering engine.

## Limits

- No real OpenAI, Runway or Alibaba generation was purchased. Provider calls in automated tests use mocks; the HTTP/DOM test kept paid calls disabled. Existing recorded clips in tests are synthetic local fixtures.
- No real notification email was sent. Confirmation/outbox and SMTP failure behavior were tested with fixtures/mocks. Deliverability still depends on the configured SMTP service and approved sender.
- Browser connections could not reach the isolated workspace preview. Visual desktop/mobile layout, native phone sharing and actual iOS Safari suspension/lock-screen behavior remain unverified. Use the installation guide’s device checklist.
- Process-interruption recovery is conservative: queued operations resume; expired in-flight operations are marked interrupted to avoid automatic duplicate charges; saved provider IDs continue status checks. Browser closure is supported only after task acceptance and while the server remains running.
- API usage/price estimates are not provider-confirmed financial charges. Historical calls and full realtime voice usage are not reconstructed by the CSV export.
- This release was packaged as source/update downloads. The user’s local VS Code files, GitHub repository and Render deployment were not modified.

