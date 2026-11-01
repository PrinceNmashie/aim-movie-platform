# AIM.movie reference flow and status fix — October 31, 2026

This is a changed-files patch for the October 30 UI refresh. It includes the revised logout placement; do not reapply the older Logout Fix afterward.

## Install on your existing Render site

Extract `AIM_movie_Reference_Flow_Fix.zip` and upload the files inside it to the matching paths in your existing GitHub repository. Keep the lowercase `static/` and `tests/` folders. Commit the complete set, deploy the commit on the existing Render service, then hard-refresh the browser.

Keep the existing persistent disk, mount, `AIM_DATA_DIR`, API keys, session settings and start command. No persistent-data download or database replacement is required. No new production dependencies are needed. This package contains no live data or credentials.

Changed runtime files:

| Folder | Files |
| --- | --- |
| Root | `app.py`, `background_tasks.py`, `notifications.py`, `studio.py` |
| `static/` | `app.js`, `engagement.js`, `feed.js`, `platform.js`, `portal.js`, `portal_extras.js`, `providers.js`, `ui.css`, `ui.js` |

The patch also includes this guide and three verification files: `tests/test_generation_flow.py`, `tests/test_background_engagement.py`, and `tests/ui_refresh_dom.mjs`. Unchanged source files are not included.

## Resulting behavior

- The character page now asks **Use as character reference** or **Save only**, immediately below the image-generation controls. The choice saves with the character and appears in the Render summary. Existing characters default to reference use, matching their prior behavior.
- Save only keeps the original image and versions. It excludes that character image from automatic video references and scene-frame composition, and prevents a combined-cast sheet from bypassing that choice. Direct uploads on Render remain deliberate separate references. Descriptive character text still guides the story/prompt.
- Render explains incompatible image-use choices and offers explicit actions for reference or text-only modes/models. Changing a model preserves the current prompt and fits duration to its supported limits. Build the shot prompt again after changing references.
- The bell and notification preferences cover **finished clips ready to watch** only. Quick text/image tasks, review actions and video submission acceptance no longer generate inbox notices. Actual errors remain in their existing task/project views. Optional verified email delivery, when configured, follows the same clip-only choice.
- Logout is in **Account settings → Security → Sign out of this device**, separate from Delete account. It is removed from the main navigation.
- The filled gear icon sits with the labeled Settings action beside Edit profile. Tasks is removed from the profile tabs; **Generation history** is linked from My Studio.
- Existing generation-status labels and presentation remain. The monitor no longer treats an unfinished clip as a failure. It checks the saved job directly, waits for a locally saved completed clip, and sends one ready notification. Matching old false-failure records are repaired from the same workspace’s saved job state when history is opened or maintenance runs. This does not resubmit a paid generation.
- The prompt-length fraction is hidden. Validation remains active, with a plain-language message only if a prompt exceeds the limit.

## Enable the time estimate later

**Everything related to the time estimate is commented out. Nothing is shown until you enable it.** The future estimate sits on Render below the length controls and leaves the existing generation-status display alone.

There are three marked locations:

1. In `static/providers.js`, search for `GENERATION_TIME_ESTIMATE_HELPERS_START`. Remove the opening `/* GENERATION_TIME_ESTIMATE_HELPERS_START` line and the closing `GENERATION_TIME_ESTIMATE_HELPERS_END */` line. Keep the code between them.
2. Inside that code, fill a matching row in `GENERATION_TIME_SAMPLES` using real measurements:
   - `clipSeconds`: the output clip length you measured, in seconds.
   - `fastSeconds`: the lower measured end-to-end generation time, in seconds.
   - `slowSeconds`: the upper measured end-to-end generation time, in seconds.
3. In `static/providers.js`, find `GENERATION_TIME_ESTIMATE_ENABLE` and uncomment the following `updateGenerationTimeEstimate(seconds);` line.
4. In `static/app.js`, find `GENERATION_TIME_ESTIMATE_ELEMENT`. Remove the opening HTML comment line and its closing `-->`, leaving the `<p id="generation-time-estimate" ...>` element in place.

The included empty rows cover direct Alibaba Wan 3.0, Singapore, image-reference mode, at 720P and 1080P. Add rows for other provider/model/region/mode/quality combinations you measure. A Runway row format is included as a code comment.

The helper scales the measured generation-time range by the selected output duration and rounds to minutes. It is approximate, not a remaining-time countdown. Missing, zero, invalid or mismatched measurements keep the estimate hidden. No placeholder timings have been invented, and the estimate makes no API calls. Commit the two edited JavaScript files, redeploy and hard-refresh when you enable it.

## Validation

254 Python tests passed in a full regression run, including pending-to-completed video monitoring, real failures, repair of old false failures, clip-only notifications, reference opt-out, combined-cast exclusion and preserved uploads/images/approvals. Both frontend check suites and production syntax checks passed. DOM checks also exercise the dormant estimate with synthetic test numbers without enabling it in production source.

Desktop browser inspection used production UI files with synthetic API/media fixtures for the image-use selector, profile gear/settings placement, Security logout, notification preference, hidden counter/estimate and existing generation-status presentation. No live provider generation or email was sent. Actual phone layout and physical-device voice behavior remain unverified. GitHub and Render are updated only when you upload and deploy this patch.
