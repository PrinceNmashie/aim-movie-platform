# AIM.movie Creator Platform — non-storyboard test version

A runnable Flask app built from the non-storyboard Full Creative Studio. Includes whole-book import and adaptation context, private user accounts/projects, a community video feed, public creator profiles, reactions, staff review with creator-controlled publication, and a live voice conversation with MIA. Existing creative brief, character sheets, script, shot plan, Runpod/Alibaba rendering, last-frame continuation, named archives and scene assembly remain available.

This is a local multi-user prototype, not a publicly deployed production platform. Public means the Discover route within the same running instance. Other people need access to the same hosted server to share a community. This package does not set up public hosting or billing.

## Update an existing Creator Platform installation

Stop the old server. Extract this complete ZIP into a new folder, copy your **entire existing `data/` directory** and **`.env`** into it, and keep your custom `workflow.json` if changed. Use the new Python, static and template files together. Start `python app.py` and hard-refresh the browser. Accounts and existing work are retained; the database upgrades automatically. This is a full update, rather than the earlier two-file password fix.

## Start

Use Python 3.10 or newer, preferably 3.12. Extract into a NEW folder and keep your current app intact.

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

Open **http://127.0.0.1:8501**. You can also use `start.command` on macOS or `start.bat` on Windows. If the port is occupied, use `python app.py --port 8502`.

Sign-in opens Discover. People can watch/react with the same account they later use to create; Studio creates a private project only when opened.

Register your administrator account first. The first real account receives the administrator role; later registrations are creators. No accounts or preset passwords are bundled. Subsequent users cannot choose a staff role during registration.

Paid API requests are OFF by default. You can test import, manual planning, accounts, uploads, community reactions, review and publication without API keys. To test AI features, edit `.env`, add your keys, set `AIM_ALLOW_PAID_API=1`, and restart. All users use the server owner's API balances. ChatGPT subscription usage does not pay for these API calls.

Read **CREATOR_PLATFORM_GUIDE.md** for the updated review → creator publication walkthrough, public captions versus private notes, profile editing, book/voice costs, migration and test limits.

## Reuse your existing work

Do not overwrite your original installation. Copy its `.env` into this new folder if you want to reuse its connections, then explicitly add `AIM_ALLOW_PAID_API=1` only when ready for paid features. This version defaults to paid calls OFF even if the old file lacks that setting.

After registering, stop the app and import the OLD non-storyboard `data/` directory as a new private project:

```bash
python manage.py import-legacy --email your-email@example.com --source /absolute/path/to/old-app/data --name "My existing movie"
```

The original directory is unchanged. The SQLite database is copied through its backup API. Images, clips and project archives are copied to that account's new project. Restart and select the project under Account. Keep a backup of both installations. Do not point this importer at the storyboard version or at another multi-user platform directory.

## Optional demo feed

```bash
python manage.py seed-demo
```

Creates three clearly labeled motion-graphic placeholders for testing playback, reactions and feed ranking. They are not presented as AI-generated films or measured staff evaluations. No API calls are made. Real uploads still need staff approval.

## Staff accounts

Register the person normally, then stop the server and run:

```bash
python manage.py set-role --email reviewer@example.com --role reviewer
```

Roles: `creator`, `reviewer`, `admin`. Staff cannot approve their own submissions. Administrators can edit provisional rules; changes affect future submissions. Review records preserve each submission's original rule version.

## Tests

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python tests/export_ui_fixture.py /tmp/aim-ui.json
node tests/frontend_contracts.mjs /tmp/aim-ui.json
```

Node is needed only for the front-end contract checks, not for running the app. Tests use isolated directories and mocked provider APIs. They do not spend generation credits. See VERIFICATION.md for exactly what was checked.

## Password compatibility fix

This revision explicitly uses PBKDF2-HMAC-SHA256 with 1,000,000 iterations for new passwords, password changes, local password resets and demo seeding. It fixes `module 'hashlib' has no attribute 'scrypt'` on Python installations without scrypt support. Passwords remain salted and hashed. Existing hashes are still checked using their stored method.

The password compatibility fix remains included in this full update. No database deletion or Python installation change is required. Follow the full Creator Platform update instructions above. If a previously imported account uses scrypt on an installation without scrypt support, use `python manage.py reset-password --email your-email@example.com` to set a compatible new password without deleting the account or its projects.

## MIA and creator publication update

AIM.movie is still the platform name. MIA is the assistant name in chat, voice and AI loading states. Enter sends chat; Shift+Enter inserts a line.

Staff approval returns a video to its original creator, ready to publish. The creator previews the public post and confirms Publish. Account and Share show the source project, creator and reviewer separately. Review notes stay private; public captions are separate. Discover names/avatars link to public profiles. Caption revisions can reuse the approved video, but must go through review before creator publication.

For this full update, use the new code, templates and static files together. Stop the server, extract this ZIP into a new folder, copy the entire existing `data/` directory and `.env` into it, and preserve any custom workflow.json. Start `python app.py` and hard-refresh the browser. The platform database upgrades automatically, retaining accounts and existing published posts under their original creator. A pre-upgrade database backup is created for an existing installation. Do not replace this update with only the two password-fix files.
