# AIM.movie Creator Platform — non-storyboard version

> **Current release: UI refresh (October 30, 2026).** Start with [UPDATE_UI_REFRESH.md](UPDATE_UI_REFRESH.md). It includes prior releases plus the swipe feed, speaker icons, creator profiles/settings, conversation clearing, longer-take planning and character-reference inputs for supported Runway models. Install the complete file set together.

Updated October 28, 2026. This Flask app includes private accounts/projects, whole-book import, conversation and live voice with MIA, creative planning, video generation, last-frame continuation, named archives, scene assembly, staff review, creator-controlled publication, and a community feed. AIM.movie remains the site name.

This release replaces Runpod with **Runway Developer**, exposing all 25 documented text/image video models, and keeps direct **Alibaba Wan 3.0** with 2–30-second output. It includes profile pictures and private liked videos. Operational notes, API setup, billing breakdowns and test labels are shown only to administrators. No accounts, keys, project data, or prepaid credits are bundled.

## Update your existing Render installation

Use **AIM_movie_UI_Refresh_Update.zip** for an existing hosted installation. Extract it first; GitHub needs the files inside it, not the ZIP itself. Read `UPDATE_UI_REFRESH.md` for the current installation steps.

1. Keep the existing Render service, persistent disk mount and `AIM_DATA_DIR`. No persistent-data download or upload is required for this code update. Accounts, projects and media stay on that disk.
2. Replace the listed Python and `static/` files. Add the new root file `runway_client.py`. Preserve the `static` folder structure when uploading through GitHub.
3. Delete the retired root files `runpod_client.py` and `workflow.json` from the application source. Keep an offline copy of any customized old workflow for historical reference.
4. Keep your existing `wsgi.py`, Gunicorn/hosting additions to `requirements.txt`, Render start command, persistent disk and data-path settings. Keep your real `.env`; `.env.example` is only a template.
5. In Render → Environment, set the Runway variables below. Keep your OpenAI/Alibaba keys and existing settings. Remove old Runpod credentials, endpoint and benchmark variables.
6. Deploy, then hard-refresh. An additive avatar column is created automatically; existing accounts, projects, reviews and reactions remain in place. Saved project provider choices override the environment default; select Runway in Produce → Render where needed.
7. Verify sign-in, a saved video, Account → Settings, and Account → Liked videos before a short paid generation test. Profile pictures and downloaded Runway outputs use the existing persistent data disk.

Removing this integration does **not** stop external Runpod resources. Stop/delete workers or Pods you no longer need in Runpod to avoid ongoing charges. Previously downloaded Runpod clips remain playable and usable for assembly/review. Unfinished old Runpod tasks cannot be refreshed through this release.

Requirements include Gunicorn for the Render entry point. The full ZIP also supports a clean local installation; retain any other customized hosting dependencies.

## Connect and use Runway

Set these in Render Environment, or in `.env` locally:

```dotenv
RUNWAYML_API_SECRET=your_runway_developer_project_key
VIDEO_PROVIDER=runway
RUNWAY_MODEL=gen4.5
AIM_ALLOW_PAID_API=1
```

Keep the key server-side. Runway Developer credits are separate from a consumer Runway subscription. The app submits one task, saves its ID, checks its status, and copies successful output into private project storage because provider download URLs expire. If copying fails, use **Check status** again before submitting another generation.

### Choose a model

In Produce → Render, choose Runway, then select a model. The picker changes length, size, quality, sound controls and prompt limit to fit the selected model. Gen-4 Turbo requires a starting frame; the other 24 models also offer text-only input.

| Models | Supported length |
| --- | --- |
| Gen-4.5, Gen-4 Turbo | 2–10 seconds |
| Veo 3.1, Veo 3.1 Fast | 4, 6 or 8 seconds |
| Gemini Omni Flash, Omni Flash 1.1 | 3–10 seconds |
| Kling 4.0 | 3–30 seconds |
| Kling 3.0 Standard / Pro / 4K; Kling O3 Standard / Pro / 4K | 3–15 seconds |
| Kling 2.5 Turbo Pro | 5 or 10 seconds |
| Seedance 2.5 | 4–30 seconds |
| Seedance 2.0, 2.0 Fast, 2.0 Mini | 4–15 seconds |
| Wan 3.0, Wan 3.0 Prime (through Runway) | 2–30 seconds |
| HappyHorse 1.0 | 3–15 seconds |
| MiniMax H3, H3 Max | 5–15 seconds |
| Grok Imagine 1.5, 1.5 Lite | 1–15 seconds |

Contracts and prices were checked against official Runway Developer documentation on October 28, 2026. Account access/region/provider moderation may still reject a documented model. The app does not query a per-account available-model list or fall back to another paid model automatically.

Choose Image references for Runway Wan 3.0/Prime, Seedance 2.0/Fast/Mini, Seedance 2.5 or Kling 4.0 to send character sheets as references. Opening-frame mode sends one composed scene frame or captured last frame; a bound character sheet is blocked in that mode. Text-only sends no images. Previous-video and extra-keyframe inputs are not exposed. Additional Runway editing, motion capture, image/audio generation and upscaling endpoints are outside this model picker.

The prompt counter uses each model's actual limit (1,000–26,000 UTF-16 units). Some emoji count as two. Supported sound toggles are sent only to models that accept them; quality and shape controls likewise send only supported fields. Selected duration is restricted to the model's allowed choices, including Veo's discrete 4/6/8-second choices. Changing models fits the current duration to the nearest supported value and preserves the original shot plan. No automatic extra paid calls occur.

### Cost display

Everyone sees concise estimates and a per-second rate. Only admins see credit calculations, list-price dates/links, provider-reported usage, API setup and diagnostics. Quotes account for model, selected output quality, optional sound, first-frame surcharges, minimum charges and applicable rounding. Kling 4.0's published promotion expires automatically after November 30, 2026 UTC. Estimates are not invoices; provider/account discounts, taxes and later price changes can differ.

Gen-4.5 remains listed at 12 credits/second ($0.12); Turbo at 5 ($0.05), at $0.01 per Developer credit. Other models have their own prices. Sources: https://docs.dev.runwayml.com/guides/pricing/ and https://docs.dev.runwayml.com/api/

### Direct Alibaba: full 30-second output

The old 15-second cap was imposed by the app. Direct `wan3.0-video` now accepts **2–30 whole seconds** for text, first-frame and image-reference modes. Shot planning, prompt compilation, render controls, estimates and continuation preserve up to 30 seconds. Direct Alibaba remains a separate service/key from Wan models billed through Runway.

Wan's 30-second **output** maximum does not mean that 30 seconds of input video are accepted. Alibaba's documented reference-video total is at most 15 seconds, and input video plus output must fit within 30 seconds. This non-storyboard workflow currently sends text/images, not prior video. Source: https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference

## Profile pictures and liked videos

- **Account → Account settings → Profile picture:** upload, replace or remove a JPG, PNG or WebP up to 5 MB and 16 million pixels. The app center-crops to a 512×512 JPEG and strips metadata. Pictures appear on the dashboard, public creator profile and video author links. Initials are the fallback.
- Pictures are public. Replacing/removing one invalidates its old app URL. Account deletion removes its stored picture.
- **Account → Liked videos:** privately browse published videos you liked, load more or remove a like. Other users cannot view your collection. Unpublished/removed videos disappear from it. Public creator profiles still show only published creations.

These features make no AI API calls. Storage/bandwidth use hosting resources.

## Start locally

Use Python 3.10 or newer, preferably 3.12. Extract into a new folder and keep your current app intact.

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python app.py
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python app.py
```

Open **http://127.0.0.1:8501**. The included `start.command`/`start.bat` launchers also work. For another port, use `python app.py --port 8502`.

For an existing local multi-user installation, stop the server, extract the full ZIP into a new folder, copy your **entire existing `data/` directory** and real `.env` into it, add the Runway settings, then start. Keep the old installation as a backup. No re-registration is needed.

The first real account receives the administrator role; later registrations are creators. Sign-in opens Discover. The same account can watch and create; opening Studio creates its private project.

Paid API requests default **OFF**. Accounts, avatars, likes, local book extraction, manual planning, uploaded video, review and publication can be tested without keys. All enabled API calls use the server owner's balances; no user billing, wallet or subscription system is implemented.

## Import an older single-user project

Only for the OLD non-storyboard single-user app, register first, stop the server, then run:

```bash
python manage.py import-legacy --email your-email@example.com --source /absolute/path/to/old-app/data --name "My existing movie"
```

This copies the source as a new private project. Do not point this importer at a multi-user platform directory or the storyboard version. Ordinary multi-user upgrades preserve the complete data directory as described above.

## Staff and demo setup

Administrators can manage registered users in Account settings. Server-shell alternatives:

```bash
python manage.py set-role --email reviewer@example.com --role reviewer
python manage.py reset-password --email creator@example.com
python manage.py seed-demo
```

Roles are `creator`, `reviewer`, and `admin`. Password reset prompts privately. Optional demo seeding creates three labeled local motion-graphic fixtures without paid calls. Staff approval returns a submission to its original creator; only that creator can publish it. Private staff notes and public captions stay separate. At least one administrator must remain.

## Verification

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python tests/export_ui_fixture.py /tmp/aim-ui.json
node tests/frontend_contracts.mjs /tmp/aim-ui.json
```

Node is needed only for frontend contract checks. APIs are mocked; video tests use local ffmpeg. See `VERIFICATION.md` for coverage/limits and `CREATOR_PLATFORM_GUIDE.md` for the complete workflow. This source update does not deploy your Render service or validate live API charges.

## Local Runway troubleshooting

Running at localhost:8501 is supported; the app sends a selected local image as encoded image data, not a localhost URL. If Runway rejects a request, the administrator now sees the returned validation field/reason, safe model/length/size settings and request ID when available. The same bounded, redacted diagnostic appears in the server terminal. Member messages stay concise. Keys, full prompts, image data and signed URLs are omitted. No automatic generation retry is added.

The Developer portal also shows failed requests under Manage → Request History. Check its response and credit balance before trying again. A test run with an empty balance does not establish that a model's input settings are wrong. Error reporting itself makes no extra provider requests.
