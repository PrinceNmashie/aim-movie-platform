# AIM.movie UI refresh — October 30, 2026

This package updates your existing GitHub → Render installation. It includes the earlier account, Runway, background-task and notification work. Install the files together; older ZIPs are not required first.

## Install through GitHub and Render

1. Extract **AIM_movie_UI_Refresh_Update.zip**. Upload the **files inside it**, preserving the lowercase `static/`, `templates/` and `tests/` folders. Put root Python files next to the existing `app.py`. Uploading the ZIP itself does not update the app.
2. Replace matching code files and add the new files. `UPDATE_FILE_LIST.txt` lists the contents. This update includes `gunicorn` in `requirements.txt` and your Render `wsgi.py` entry point. Retain any other hosting dependencies you added.
3. Keep the existing Render service, persistent disk/mount, `AIM_DATA_DIR`, API keys and other environment settings. Keep the same start command; the included entry point supports `gunicorn wsgi:app` if that is your existing command. Commit the whole file set before deploying.
4. If still present, delete the retired root source files `runpod_client.py` and `workflow.json`. They are unused. Keep the required `runway_models.json`; it is a different file.
5. Deploy the updated commit, then hard-refresh the site: Command+Shift+R or Control+Shift+R on desktop, so scripts and styles load together.

**You do not need to download Render’s persistent data to install this code update.** Existing accounts, projects and media stay on the same Render disk. Do not upload that data to GitHub, replace the disk, or change its mount/data-path setting. The ZIP contains no live accounts, media or credentials. Keep a real `.env` out of GitHub; `.env.example` is only a configuration reference.

The full **AIM_movie_Creator_Platform.zip** contains the same current code under one application folder, with tests and examples. Use either package, not both in sequence. This work does not deploy to GitHub or Render automatically.

## Included changes

| Area | Behavior |
| --- | --- |
| Discover and shared links | One video fills the viewing area. Swipe vertically, use desktop arrows, or press Up/Down. Only the active video plays. Results append without restarting the current clip; distant media is unloaded. |
| Sound | Sound is on by default. The speaker icon changes to a muted icon when pressed; that choice carries to subsequent clips on the page. Browsers that block audible autoplay show a tap-to-play prompt. A website cannot override that browser rule. |
| Viewer information | Dimensions, sound diagnostics, reviewer attribution and source-project boilerplate no longer clutter viewer cards. Search is behind its icon. Private staff tools remain available to staff. |
| Profiles | Avatar/name/bio header, actual creation/follower/following/like counts and a thumbnail grid. Your profile has Creations, Drafts & reviews, Projects, private Liked/Saved links and Tasks. Thumbnails open the swipe player. |
| Settings | Account settings show one panel at a time. Studio navigation has Develop/Plan/Produce/Share tabs and a settings icon. |
| Conversation | Clear draft empties the unsent message. New conversation clears this project’s chat after confirmation and ends its voice session. Drafts, images, videos and approvals stay saved. Late voice transcripts from that cleared session are rejected. |
| Voice | Interrupt MIA is removed. Automatic interruption when speech starts remains enabled; Stop ends the session. |
| Character images | Selected versions are identified as references. Refinement and optional identity photos are expandable. Picture 1/Picture 2 assignment buttons are removed from the character flow. Selected sheets attach when building a prompt in reference mode; deliberate uploads/continuation frames are preserved. |
| Planning | The technical clip-count/seconds strip is removed. The backend favors fewer continuous takes within model limits. Connected 5+5+5-second beats can become one 15-second take where supported. Scene boundaries and meaningful explicit cuts remain. Gen-4 retains its real 10-second maximum. |
| Runway output | Quality shows 480p, 720p, 1080p and other genuinely supported names. Format is a separate landscape/portrait/square choice. Native request dimensions stay internal. Models with a single quality or names such as 768p/2K retain those limits. |
| Runway references | Wan 3.0/Prime, Seedance 2.0/Fast/Mini, Seedance 2.5 and Kling 4.0 expose Image references. Reference images go to text-to-video without becoming the opening frame. Direct Alibaba reference mode remains available. |

Gen-4.5 and Gen-4 Turbo do not provide that reference input in this workflow. Their opening-frame mode needs a **scene frame**, not a multi-view character sheet. A bound character/cast sheet is blocked before a paid submission in that mode. Choose **Use character references instead** to switch to Runway Wan 3.0 reference mode, or deliberately create a scene frame for an opening-frame model. Existing model choices remain until you change them.

References guide the model; they cannot guarantee identity fidelity or composition. No extra paid generations are started automatically to work around model limits.

## Check after deployment

1. Sign in and open a saved project/video to confirm the existing data path is in use.
2. In Discover, swipe after any initial browser-required tap. Confirm only the current clip plays; test both speaker icons.
3. Open the profile, collections and relevant settings panels on desktop and your actual phone.
4. Test Clear draft and New conversation in a disposable chat; confirm saved drafts/media remain.
5. Select the video model, Quality, Format and Image use. Build a prompt from a planned shot to attach selected character references. Review the estimate before generating.

240 Python tests and both frontend check suites pass. Desktop browser inspection used production UI files with synthetic API/media fixtures. No paid generation or live voice call was made. Actual phone touch behavior, native sharing, audible device output and Safari background behavior require the device check. See `VERIFICATION.md`.

Reference contracts checked October 30, 2026 against official Runway sources:

- https://docs.dev.runwayml.com/assets/inputs/
- https://dev.runwayml.com/learn/wan-3-0-api
- https://github.com/runwayml/sdk-python/blob/main/src/runwayml/types/text_to_video_create_params.py
