> The newer combined update also includes background work, notifications and engagement. Use [UPDATE_AIM_COMPLETE.md](UPDATE_AIM_COMPLETE.md) for the complete installation. This document remains a reference for provider capabilities.

# Runway model catalog, 30-second Wan and account update

October 28, 2026. Use this combined update **instead of the earlier Runway ZIP**. It includes the earlier Runway replacement, editable profile pictures and private liked videos, plus the full text/image model picker, 30-second direct Wan output and admin-only operational wording. No earlier ZIP installation is needed.

This patch targets the existing non-storyboard AIM.movie Creator Platform with Account Settings. It updates source files and contains no private data or real keys. Your existing Render service is not modified until you upload and deploy it.

## Add or replace these exact paths

| Folder | Files |
| --- | --- |
| Repository root | `app.py`, `ai_layers.py`, `creator_portal.py`, `studio.py`, `video_tools.py`, `video_providers.py`, `wan_client.py` |
| Repository root — new files | `runway_client.py`, `runway_models.py`, `runway_models.json` |
| `static/` | `app.js`, `providers.js`, `portal.js`, `platform.js`, `platform.css`, `publication.js`, `voice.js` |
| `templates/` | `index.html`, `portal.html` |

All **19 runtime files** must be updated together. The JSON file is the model contract catalog and is required; it is not an old ComfyUI workflow. Documentation and `.env.example` are included separately. Keep your real environment settings.

Delete the retired root `runpod_client.py` and `workflow.json` after backing up. Keep any customized old workflow offline if wanted. No new production packages, manage.py changes, wsgi.py changes or hosting requirements changes are required by this patch.

## Install on Render through GitHub

1. Back up the **entire persistent data directory**, including platform.sqlite, account/project files, archives, media and the session secret. Retain the existing source and Render configuration. Finish active generation work before deploying.
2. Extract the ZIP on your computer. Upload/replace the root files at the root, the static files inside `static`, and the template files inside `templates`. Preserve both folders. Do not upload the ZIP itself as application source.
3. Delete the two retired Runpod files. Keep your existing wsgi.py, Gunicorn/hosting additions to requirements.txt, Render start command, persistent disk mount and AIM_DATA_DIR setting.
4. Render → Environment: add `RUNWAYML_API_SECRET` using a **Runway Developer project** key. Set `VIDEO_PROVIDER=runway`. Optionally set `RUNWAY_MODEL=gen4.5`. Keep `AIM_ALLOW_PAID_API=1` when you want paid generation enabled. Keep your existing OpenAI/Alibaba keys, session/cookie settings and other non-Runpod variables. Never commit a real key to GitHub.
5. Remove the old Runpod API/endpoint/pricing variables. Deploy once the complete file set has been uploaded. Hard-refresh afterward: Command+Shift+R on Mac or Control+Shift+R on Windows.
6. Existing accounts, password hashes, projects, reactions, reviews and published posts remain. The avatar column is added automatically. Saved Runpod provider selections migrate to Runway; a saved Alibaba selection remains Alibaba. Choose Runway in Produce → Render when desired.
7. Stop/delete unused workers or Pods in the Runpod dashboard. Retiring app code does not terminate external billable resources. Old downloaded Runpod clips remain usable; unfinished Runpod jobs are not refreshed or migrated.

Local alternative: extract the full source ZIP into a separate folder, copy your entire existing `data/` and real `.env` into it, add the Runway variables, and run `python app.py`. Keep the old folder as a backup. Do not run the single-user legacy importer against multi-user platform data.

```dotenv
RUNWAYML_API_SECRET=your_runway_developer_project_key
VIDEO_PROVIDER=runway
RUNWAY_MODEL=gen4.5
AIM_ALLOW_PAID_API=1
```

You do not need to edit environment variables every time you switch models. Use the model dropdown. Runway consumer subscriptions and Developer credits are separate.

## What changed

### Clean member and guest pages

API setup instructions, environment variable examples, provider connection checks, credit breakdowns, published-rate notes, generation diagnostics, prototype/test labels and recommendation-test explanations are shown only to administrators. Members and reviewers get the clean view; guests get the clean public/sign-in pages. Basic form guidance, validation, privacy labels and concise estimated prices remain visible. This does not add user payment processing.

### 25 Runway text/image video models

Runway's single image-to-video endpoint accepts many model IDs. This version sends the model actually chosen in the dropdown and uses its own supported request fields:

- Gen-4.5; Gen-4 Turbo.
- Veo 3.1; Veo 3.1 Fast; Gemini Omni Flash; Gemini Omni Flash 1.1.
- Kling 4.0; Kling 3.0 Standard/Pro/4K; Kling O3 Standard/Pro/4K; Kling 2.5 Turbo Pro.
- Seedance 2.5; Seedance 2.0; Seedance 2.0 Fast; Seedance 2.0 Mini.
- Wan 3.0; Wan 3.0 Prime; HappyHorse 1.0.
- MiniMax H3; MiniMax H3 Max.
- Grok Imagine 1.5; Grok Imagine 1.5 Lite.

Length, shape, quality, sound toggles and prompt limits follow the selected model. Veo uses 4/6/8 seconds; Kling 2.5 uses 5/10; Gen-4 uses 2–10; Runway Wan uses 2–30. The README contains the complete duration table. Changing models fits the current render length to the nearest supported choice while keeping the original shot plan. No extra generation calls or automatic model fallback are launched.

Gen-4 Turbo requires a starting image. Other models also offer text-only generation. Image mode sends the selected Picture 1 or Picture 2 as one first frame; text mode sends neither. This picker does not expose Runway's extra video-edit, motion-capture, multimodal reference, end-frame, image/audio-generation or upscaling tools. Existing last-frame capture and assembly remain available. Catalog availability was checked October 28, 2026; individual account access and provider checks still apply.

### Full 30-second Alibaba output

The earlier 15-second cap was in the app. Direct `wan3.0-video` now accepts 2–30 whole seconds in text, first-frame and image-reference modes. Shot plans, compiled prompts, render length, estimates and continuation accept the extended range. Wan through Runway is a separate model/service and uses Runway credits; direct Alibaba uses your Alibaba key.

The documented **input-video** limit differs: a maximum of 15 seconds of references, with total input plus output no more than 30 seconds. This workflow currently sends text/images and does not send the previous whole video.

### Profile pictures and liked videos

Account → Account settings: upload/replace/remove a public JPG, PNG or WebP up to 5 MB and 16 million pixels. Stored as a centered 512×512 JPEG without source metadata; initials are the fallback. Replacing/removing invalidates the old app URL. Account deletion removes its stored active picture.

Account → Liked videos: privately view your liked published posts, load more or unlike. Unpublished/removed posts disappear. Each account has its own collection; profiles list published creations, not private liked history.

## Test after deployment

1. As a guest, check Discover and Sign in: no test labels or API explanations. As a normal member, check Account, Studio, Settings and Render: concise controls/prices, no setup or billing diagnostics. As admin, confirm the operational notes remain available.
2. Open an old account/project and a saved clip. Confirm the data/history is present. Try profile-picture upload/removal and Like → Account → Liked videos.
3. Produce → Render: choose Runway and switch between Veo, Kling, Seedance, Wan and Gen-4. Confirm allowed length/shape/sound controls change appropriately. Check that selecting Veo cannot submit 5 seconds and selecting Wan offers 30.
4. For a small **paid** test, choose Gen-4 Turbo, a composed scene image and 2 seconds. At listed prices this is estimated at $0.10. Generate once, check status, then confirm the video is saved and playable. Use Check status to retry a failed download for the same task; do not generate a duplicate.
5. A separate small model test can verify the chosen model in Runway's task history and compare actual credits with the estimate. If initial submission times out, inspect task history before retrying. Provider URLs expire; successful output is copied to your persistent disk.
6. On direct Alibaba, verify the 30-second option without submitting first. A real 30-second 720P Singapore test is estimated at $3.00 at the checked rate; use your selected region's displayed estimate and record dashboard charges.
7. Capture a last frame, continue and assemble, then use Send for review → staff approval → creator publication. Original ownership/private notes remain intact.

Model/quality/sound rates, first-frame surcharges, minimum charges and credit rounding are reflected in estimates. The published Kling 4.0 promotion expires automatically after November 30, 2026 UTC. Taxes, account discounts and later provider price changes may differ. Review actual dashboards for billed usage.

## References and verification

- Runway model/API contracts: https://docs.dev.runwayml.com/api/ and https://docs.dev.runwayml.com/guides/models/
- Runway pricing: https://docs.dev.runwayml.com/guides/pricing/
- Alibaba output/input limits: https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference
- Alibaba pricing: https://www.alibabacloud.com/help/en/model-studio/wan3-0-video

All 49 supported model/input-mode payloads were validated against Runway's official OpenAPI, with no paid calls. See VERIFICATION.md for the final automated test count and limits. Live model access, generated quality, invoice accuracy and visual browser/mobile behavior need your deployment walkthrough. Durable background jobs and mobile background-tab recovery remain separate work.

## Runway error-detail improvement

For a local installation that already has the 25-model catalog, only runway_client.py changed at runtime in this small diagnostic update. Stop the app with Control+C, replace that file beside app.py, then restart with python app.py and hard-refresh. No Render deployment, package installation or data reset is needed. Older builds without runway_models.py and runway_models.json should use the complete update first.

Administrators and the server terminal now receive the rejected field/reason plus model/settings and request ID, with secrets/prompts/media/links redacted. Regular accounts keep the clean message. The app still sends one generation request; it does not retry a rejected submission automatically. Existing failed requests can be inspected in Runway Developer → Manage → Request History without submitting another paid generation.

Eight new diagnostic tests passed; the targeted provider/model/error suite passed 73 tests. These validate error handling with mocked responses, not a specific live request or actual account balance.
