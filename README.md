# AIM.movie

AIM.movie is a capstone prototype for developing, generating, and sharing short films. Creators work in private projects in **My Studio**. **Discover** is the public feed for films their creators have chosen to publish after staff approval.

## Creation workflow

| Stage | What the creator does |
| --- | --- |
| **Develop** | Discuss an idea with MIA by text or voice, or import a book or script through **Adapt a story**. Review the direction in the creative brief. |
| **Plan** | Develop characters, a script, and a shot plan. Review and approve the drafts before generating a planned shot. |
| **Produce** | Pick a shot, review its video instructions, and choose a model and output settings. Finished renders appear in the video library. Arrange clips in **Scene builder** to export a scene. |
| **Share** | Submit a render, scene, or uploaded video. Staff review the submitted version. Approval returns it to the creator, who can preview it and publish it to Discover. |

The render check points to any approval or video instructions that need updating after an edit. A character reference guides appearance on models that support reference images. An opening image becomes the first frame of the video and requires its own confirmation.

## Run locally

Use Python 3.12. From the repository root on macOS or Linux, run the following commands.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

On Windows PowerShell, use the virtual environment's Python directly.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Open [http://127.0.0.1:8501](http://127.0.0.1:8501). The site opens on **Discover**. Register the first account on a fresh local installation to become its administrator. Later accounts are creators.

### Try the review workflow without API keys

Paid generation is off by default. To try publication, register a second account in a separate browser session. As that creator, choose **My Studio → New movie**, open **Share**, and upload a short MP4 using **Upload a video instead**. Submit it for review.

In the administrator session, open **Staff Review**, claim the submission, complete the checklist, and choose **Approve & return to creator**. Back in the creator session, open **Share** and use **Preview & publish**. The published video then appears on Discover.

To populate Discover with three labeled sample clips, run `python manage.py seed-demo` in the same environment.

## Where to read the code

Flask serves the studio and public pages. For a render, the server validates the project state, builds the provider request, and saves the returned job ID. A background task checks the provider and saves the finished video to the project.

| Area | Entry points |
| --- | --- |
| Studio and development UI | [templates/index.html](templates/index.html), [static/creation.js](static/creation.js), [static/app.js](static/app.js) |
| Story input and AI drafts | [book_source.py](book_source.py), [ai_layers.py](ai_layers.py), [live_voice.py](live_voice.py) |
| Approvals and render checks | [studio.py](studio.py), [render_review.py](render_review.py), [static/render_review.js](static/render_review.js) |
| Render requests and video processing | [app.py](app.py), [video_providers.py](video_providers.py), [runway_client.py](runway_client.py), [wan_client.py](wan_client.py), [video_tools.py](video_tools.py) |
| Background work and storage | [background_tasks.py](background_tasks.py), [store.py](store.py) |
| Accounts, review, and publication | [creator_portal.py](creator_portal.py), [static/portal.js](static/portal.js) |

## Optional provider and hosting setup

Set provider credentials in the server environment or a local `.env` file. Enable paid requests with `AIM_ALLOW_PAID_API=1` once the relevant provider is configured.

| Feature | Environment variables |
| --- | --- |
| MIA text, voice, and OpenAI generation | `OPENAI_API_KEY` |
| Runway video generation | `RUNWAYML_API_SECRET` |
| Direct Alibaba Wan video generation | `ALIBABA_API_KEY`, `ALIBABA_WORKSPACE_ID`, `ALIBABA_REGION` |

The hosted WSGI entry point is `wsgi:app`. Set `AIM_DATA_DIR` to a writable persistent disk directory for hosting. Locally it defaults to `data/`. It holds the platform and project SQLite databases, source uploads, and video files. Keep credentials and runtime data out of Git.
