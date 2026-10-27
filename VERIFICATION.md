# Verification record

October 26, 2026. This record distinguishes implementation checks from live-provider and browser validation.

## Completed checks

- 105 Python tests passed. The suite includes the retained non-storyboard workflow/provider/video-tool tests and the new account, book, review, community and voice contracts.
- Separate users and projects cannot read each other's source files, project state, clips, assemblies or review-only context routes.
- Authentication, CSRF/origin checks, password hashing, password-change session revocation, login attempt limits and staff authorization were exercised.
- Paid calls default off; server-side action counts and book-analysis budget checks were exercised with mocked APIs.
- A synthetic 100,000-word text file was imported without losing source characters. TXT, EPUB reading order, DOCX extraction, invalid/encrypted-style inputs and image-only PDF failure behavior were checked.
- Source selection reaches conversation context. Analysis resumes after saved excerpts; incomplete response usage remains recorded; optional synthesis is explicit. These provider responses were mocked, not benchmarked for fidelity.
- Real locally encoded videos exercised upload normalization, scene assembly, immutable submitted copies and adjacent-clip review playback routes. Changing an original project video did not change the published copy.
- Unapproved and approved-but-unpublished media remains private. Creator-only publication, immutable author/project ownership, idempotent release and staff revocation were checked. Incomplete checklists, self-review, competing claims, changed review files and unauthorized policy edits cannot publish. Feedback, revisions, reports, removal and withdrawal were checked.
- Like toggles and distinct signed-in view counts were exercised through separate authenticated clients.
- WebRTC request shape, server-held credentials, voice interruption configuration, transcript updates/deduplication and session closure were checked with mocked provider responses.
- JavaScript syntax checks passed for app.js, platform.js, portal.js, publication.js and voice.js.
- Front-end template contracts passed for 13 studio views with empty, imported-book and creator-submission snapshots, plus authentication, populated feed, account, review and public-profile templates. Enter-to-send, Shift+Enter, busy-state and input-method composition events were checked.
- A JavaScript controller test using DOM/media doubles exercised voice connection, incoming transcript events, interruption, microphone/peer cleanup and saved closure. These doubles are unit-test instruments, not a substitute for browser QA.
- Optional demo seeding produced three playable local motion-graphic placeholders and left the first real account eligible for administrator setup. No preset login credentials or API requests were used.

## Not verified here

- Browser rendering, responsive layout and actual browser video/audio playback were not visually verified. The managed preview could not start the Python virtual environment, so no browser screenshots or browser end-to-end pass is claimed.
- Actual microphone permission prompts, acoustic echo, latency, voice quality, speech overlap/interruption and browser/provider interoperability need the local walkthrough in CREATOR_PLATFORM_GUIDE.md.
- No live OpenAI, Alibaba or Runpod generation, actual API billing benchmark, real full-book adaptation quality measurement, or public deployment was performed. No paid provider calls were made.
- No production security audit, load test, automated content moderation, policy/legal determination or trained recommendation evaluation was performed.

Run the documented walkthrough with your API key and record actual usage before relying on a cost or quality target. The slide projections remain proposed targets, not measured outcomes of these checks.

## Password compatibility update

New password hashes explicitly use PBKDF2-HMAC-SHA256 with 1,000,000 iterations. Registration, login, password change, local CLI reset (preserving account/project identity), and demo seeding were tested with `hashlib.scrypt` removed. All 105 Python tests passed. Existing supported hashes remain verifiable using their stored method. An imported scrypt hash still requires native scrypt for verification; the local reset command can replace that hash without deleting account data.

## MIA and creator publication update

- Staff approval leaves an item private and tied to its original creator/project. Only its creator can publish it. Reviewers cannot publish someone else's submission.
- Public feeds/profiles exclude private staff notes, email, account role, project IDs, review decisions and unpublished items. Creator display-name/bio edits retain stable profile IDs.
- Caption revisions reuse immutable media, retain the older public post through review, and replace it only when the creator publishes the new approved version.
- New viewer signups and browsing do not create a private project; entering Studio activates creation under the same account.
- A real pre-update SQLite schema was upgraded with accounts, password hashes and creator/project IDs preserved. A pre-upgrade backup retained the original columns/status. Migration is idempotent, preserves existing public captions and reactions, and cannot publish new approved drafts.
- No real user's database was modified here; the upgrade was tested with isolated representative databases.
