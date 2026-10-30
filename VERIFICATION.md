# Verification — AIM.movie UI refresh, October 30, 2026

## Automated checks

- **240 Python tests passed in one full regression run.** Provider calls are mocked. Coverage includes accounts/projects, books, background work, notification/outbox, reviews/publication, media/assembly, all 25 Runway catalog models, direct Alibaba and usage records.
- New checks cover two reference inputs for each of seven supported Runway reference models; text-to-video routing without a first-frame input; rejecting bound character sheets as opening frames before a provider call; refreshing automatic references while keeping deliberate uploads; project-scoped conversation clearing; retained drafts/media/approvals; late voice-event rejection; real follow counts and public identity privacy.
- Planning checks cover a connected 15-second action in one take, evolving cast/camera direction, the Gen-4 10-second cap, meaningful scene/camera/time/creator cuts, and consolidating existing short plans at approval.
- Existing frontend_contracts.mjs passed with export_ui_fixture.py snapshots: studio/account/review/profile templates, admin/member visibility, every model’s price/duration controls, saved-output review handoff, Enter/Shift+Enter/composition and voice lifecycle/interruption events.
- ui_refresh_dom.mjs passed with JSDOM and production controllers: single active video, sound/icon state, autoplay-denial fallback, pause across tab visibility, media unloading, appended results retaining playback, profile/settings tabs preserving unsaved input, all model quality/format mappings, preserved prompt/portrait orientation after quality changes, hidden planning diagnostics, removed Interrupt button and draft clearing.

- Gunicorn 25.3.0 passed configuration checking and a real wsgi:app startup smoke check; auth and Discover returned HTTP 200 with paid APIs disabled.

## Desktop browser inspection

The managed preview served production UI files with synthetic API snapshots and local motion-graphic fixtures, isolated from real accounts and paid endpoints. Checked Discover framing, initial play affordance, unmuted playback, next-video navigation pausing the previous clip, profile header/grid, account settings and Profile/Security navigation, and render model/image-use/quality/format selectors.

Browser media state confirmed actual playback and unmuted state after the initial tap. This does not establish physical-device sound output or generation quality. Fixture responses do not replace backend payload/pricing checks.

## Limits

- No live paid OpenAI/Runway/Alibaba generation, realtime voice session or notification email was purchased/sent. Payloads and voice-event handling were tested with mocks/doubles.
- Actual phone touch behavior, native share sheets, audible output on user devices and iOS/Safari suspension/lock-screen behavior remain unverified. Narrow-screen CSS is included; use the installation guide’s device checklist.
- Browsers may require a user gesture for audible autoplay. The fallback asks for a tap and does not silently mute playback.
- Image references guide a model; they cannot guarantee identity fidelity or prevent every unwanted composition.
- Existing background recovery remains conservative around uncertain paid calls. The server must remain running for accepted work to continue.
- This release is source/update downloads. The user’s GitHub repository, live Render service and persistent data were not modified.

## Reproduce locally

Install requirements.txt and requirements-dev.txt, then run:

    python -m pytest -q
    python tests/export_ui_fixture.py /tmp/aim-ui-fixture.json
    node tests/frontend_contracts.mjs /tmp/aim-ui-fixture.json

For the additional DOM suite, install jsdom in a test environment and run:

    node tests/ui_refresh_dom.mjs /tmp/aim-ui-fixture.json

NODE_PATH may point to a separate test-only dependency directory. JSDOM is not a production dependency.
