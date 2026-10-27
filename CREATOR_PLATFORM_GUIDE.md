# AIM.movie Creator Platform: test guide and costs

Version: October 26, 2026. Built from the non-storyboard Full Creative Studio. Updated with MIA, creator-controlled publication and public profiles.

## What is included

- One account for watching and creating, with password hashes, sign-in/out, password changes and server-revocable sessions. New accounts open Discover; a private project is created only when they enter Studio or explicitly start one.
- Separate projects, project data, source files, conversations, images, clips, preferences and archives per account.
- Whole-book upload from TXT, Markdown, EPUB, DOCX and text-based PDF.
- Local extraction into source-linked excerpts, full-excerpt reading, an analysis estimate, resumable AI analysis, usage recording, a manually editable or AI-synthesized story bible, and selection of excerpts to adapt.
- Source context passed to the conversation, creative brief, character drafting, script and shot planning. Generated scripts are asked to retain source locators and adaptation changes.
- Existing non-storyboard rendering and scene assembly, including 3–15-second clip generation and last-frame continuation.
- A public-within-the-instance Discover feed, For you/Latest tabs, playback, a unique like toggle per account, distinct signed-in viewer counts, reports, clickable creator names and public profiles with editable display names and bios. Profiles list only published creations.
- Submissions from completed local/cached renders, assemblies, or uploaded MP4/MOV/WebM videos. Submissions stay private after approval until their creator previews and publishes them.
- A staff queue, exclusive claims, four provisional review checks, approval/change request/rejection, feedback, preserved review history, revision links, and revocation/removal of approved or published posts. Staff approval returns a creation to its owner and does not publish it. Creators can withdraw their own submissions.
- For assembled submissions, immutable copies of constituent clips for adjacent-shot review, up to the existing 40-clip assembly limit.
- Live speech-to-speech conversation with microphone input, AI voice output, spoken interruption, a manual interrupt control, typed input during a live session, and transcript persistence in the same project chat.

The assistant is named **MIA** in chat, voice and AI loading messages. The platform brand and organization remain **AIM.movie**. No storyboard generator or storyboard workflow is included.

## Navigation

Main navigation: **Discover · My Studio (or Start creating) · Account**. Staff also get **Staff Review**. There is no separate viewer/creator signup or upgrade: the same account can watch, react and create whenever it chooses.

Inside a project:

| Workspace | Tools |
| --- | --- |
| Develop | Project overview, Book source, Conversation, Creative brief |
| Plan | Characters, Script, Shots |
| Produce | Render, Clips, Assemble |
| Share | Private staff notes, public caption, submission, review status, creator-owned publication and revision history |

Settings and creative history remain accessible without filling the main navigation with every production step. Existing URLs remain valid.

## How a whole-book upload works

1. Open Develop → Book source.
2. Select the complete file. Prefer an unencrypted EPUB, DOCX or UTF-8 text file when possible. A PDF needs selectable text.
3. Select Import book locally. The app stores the original file privately and extracts its text on your computer. No AI API request occurs at this step.
4. Review the excerpt previews and open full excerpts to check extraction. EPUB uses its declared reading spine, PDF preserves page numbers, and all excerpts retain character ranges. Long sections are split into roughly 16,000-character excerpts.
5. Review the remaining analysis request count, planning estimate and conservative allowance. Set the book-analysis budget.
6. With paid calls enabled and your OpenAI key connected, start analysis. Each completed excerpt is saved immediately. Stop pauses after the current request; closing a page does not refund or cancel an already submitted request. Resume starts at the next unfinished excerpt.
7. Review summaries, events, cast facts, continuity and uncertainties. The original text stays available as the source of truth.
8. Optionally build a story bible from completed notes. This is a separate paid request with an estimate before it runs. Partial analysis is identified as partial coverage. Large note sets above 180,000 characters require manual consolidation in this prototype.
9. Select up to six excerpts for the scene you want to adapt. Describe the adaptation's intended duration, style, fidelity and permitted changes. Edit the bible yourself if needed.
10. Save the source selection and choose Use source in conversation. Type or speak with MIA through the creative decisions, then use the existing brief → characters → script → shots → render workflow.
11. Repeat with a new source selection for the next sequence. Source changes invalidate earlier creative approvals where applicable; existing clips are retained.

Limits: 30 MB file, 2 million extracted characters, 2,000 PDF pages, bounded archive expansion. No DRM removal. Scanned books, image-only PDFs and manga/comic artwork need OCR/visual processing that is not implemented here. Export a text-based edition for this test. The sample `examples/The_Last_Light.txt` is an original miniature book with three chapters for a quick local import.

Importing a whole book does not automatically render a full-length film. The source can be analyzed across its full length; production still works through selected scenes and short clips. Model-generated facts, source references, summaries and adaptation choices require human checking.

## Uploading versus AI costs

The implementation extracts text locally rather than uploading a whole book to a hosted file-search/vector service. There is no provider upload charge, embedding charge or hosted retrieval storage charge in this design. It uses your own disk. Future deployment would add hosting, storage, bandwidth, operations and review costs.

### Book analysis

The fixed analysis model is `gpt-5.4-mini`, with published standard rates checked October 26, 2026:

| Item | USD per 1 million tokens |
| --- | ---: |
| Input text | $0.75 |
| Output text | $4.50 |

Formula: `(total input tokens × 0.75 + total output tokens × 4.50) / 1,000,000`.

Illustrative example: **150,000 input tokens plus 30,000 output tokens = $0.2475** for that analysis usage. This is an example token workload, not a promised price for every 100,000-word book. Language, chapter structure, instructions, generated note length, retries, synthesis and later conversations change the total. A book around 100,000 English words could reasonably be tested against this general order of token usage, but the app estimates your actual extracted file before any analysis calls.

The planning estimate uses approximately four characters per token and 900 output tokens per pending excerpt. The conservative allowance uses the UTF-8 byte count plus framing allowance and the full 1,800-output-token limit. These are planning tools, not provider billing guarantees.

The server checks the saved book-analysis budget before each excerpt request using recorded usage plus the next request's allowance. The optional bible synthesis is separately requested and is not included in that excerpt-analysis budget. Incomplete/invalid analysis responses still record any returned usage because they can be billed. If a network error yields no usage, actual billing is unconfirmed; check your provider dashboard before repeatedly retrying.

Later creative drafting uses the selected text model in Settings and is billed separately. This prototype's detailed token ledger covers book-analysis/synthesis responses, not every legacy image/chat/render operation. Existing render estimates remain estimates.

### Voice

Default live model: `gpt-realtime-2.1-mini`. Published standard rates checked October 26, 2026:

| Modality | Input / 1M tokens | Output / 1M tokens |
| --- | ---: | ---: |
| Audio | $10.00 | $20.00 |
| Text | $0.60 | $2.40 |

Input transcription uses `gpt-4o-mini-transcribe`, listed at an estimated $0.003 per audio minute. Audio sessions also contain text/project context, so cost is not simply elapsed minutes multiplied by one flat rate. Reused history, caching, user/assistant speaking time and response length affect actual usage. Session usage received through the browser is retained only as client-reported diagnostics, not a trusted billing ledger. Use the API dashboard for charges.

The Talk with MIA button starts the microphone once. You can keep speaking, hear MIA, interrupt it, type a turn, stop at any time, and later continue the conversation. Reconnecting sends the latest saved conversation and project/source context. No paid image or video generation occurs automatically from the voice model. Use website buttons to make project changes or advance approvals.

Microphone access requires localhost or HTTPS. Headphones reduce echo. Sessions have browser-side limits of 10 minutes or 90 seconds without events, and navigation closes the media connection. These convenience limits and the daily API-start count are not hard financial caps against a malicious client. Stop releases microphone tracks and peer connection, saves pending transcript state and records closure. If interrupted, a transcript may contain generated words that were not played; the history labels this explicitly. Stop during an unfinished utterance can leave an unavailable-transcription marker rather than invented words.

### Video and art

Video generation, character reference art and later retries remain separate charges. Runpod uses GPU worker time; Alibaba uses its configured video generation pricing. Compare the estimates in Render. Never interpret a book-analysis estimate as the cost of producing the movie.

There is no user payment system, wallet, subscription billing or charge allocation. All requests use the owner-supplied server keys. Paid calls default OFF. `AIM_DAILY_PAID_ACTIONS=250` limits paid-start attempts per account/day; it counts starts, not dollars or voice turns. Configure external provider spend limits as appropriate for a shared test.

## A complete test with no AI spending

1. Start the app using README.md. Keep `AIM_ALLOW_PAID_API=0`. Sign-in opens Discover so viewers can browse without creating a project.
2. Register your owner/staff account first. It becomes admin.
3. Import the sample book and review its full excerpts. Add notes and an adaptation direction manually. No key is required.
4. Run `python manage.py seed-demo` in a terminal with the same virtual environment. Refresh Discover. The three posts are clearly labeled motion-graphic test fixtures, not AI films.
5. Open a private/incognito browser window and register a second account as a creator. This gives two independent login sessions on the same instance.
6. In the creator window, create a project. Open Share and upload an existing MP4, MOV or WebM. Choose clip/scene/movie, add a title, **private notes to staff**, a separate **public caption**, tags, and confirm permission to share. The private notes never become the public caption.
7. Confirm it is Submitted and absent from Discover. Another creator cannot fetch its private media.
8. In the admin window, open Staff Review and claim the submission. Play the video, inspect draft rules, and complete the four checks. Select Request changes and enter timecoded feedback.
9. In the creator window, revisit Share or Account. Read the feedback, upload a revised file and select the old submission under Revised version of.
10. In the admin window, claim the new version and choose **Approve & return to creator** after completing the checks and acknowledging the draft rules. It stays private. The creator cannot self-approve, even with a staff role.
11. In the creator window, open Account or Studio → Share and refresh status. The creation says **Approved · ready for you to publish**, names its owner/source project, and shows who reviewed it. Select **Preview & publish**. The preview shows the exact public caption and author. Confirm Publish as your display name. Staff cannot perform this action for another creator.
12. Refresh Discover. The published copy is now playable without login on this same instance. Click the creator name/avatar to view their other public creations. Logged-in viewers can like/unlike it. Views count distinct signed-in accounts, not every replay.
13. Test reports, staff removal, creator unpublishing and creator withdrawal. Unapproved, withdrawn or removed media does not remain publicly accessible through a direct media URL.

A public copy is an immutable submission file, separate from editable project media. Changing the project after submission does not silently change the approved post. New revisions retain prior review records. Staff approval leaves an earlier public version in place; **creator publication** retires earlier published versions in the same revision chain. Draft assembly is allowed privately; the assembled result requires its own approval to enter Discover. Clip approval alone does not publish a different final movie. Unpublish returns the same approved video to private status; staff removal revokes its ability to be republished.

## Testing live AI features

1. Add your OpenAI key and existing video-provider settings to `.env` without putting keys into website forms.
2. Set `AIM_ALLOW_PAID_API=1` and restart.
3. In Book source, review the file-specific estimate, set a budget, analyze a few excerpts, stop and resume, optionally synthesize the bible, then select excerpts and start the conversation.
4. In Conversation, press Talk with MIA and permit microphone access. Confirm MIA's voice plays. If autoplay is blocked, press Play on the displayed audio control.
5. Give an idea, let MIA reply, interrupt it by speaking, continue for several turns, and test the explicit Interrupt control. While connected you can also send typed messages into the same live session.
6. Stop, reload the page, and confirm the saved user and assistant turns appear in order. Test reconnecting and continuing the same idea.
7. Stop before generating the creative brief. Approvals and production actions remain explicit button actions.
8. Check the API dashboard for actual voice/analysis spending and document latency, transcription corrections, interruptions and continuity quality. No live provider benchmark has been performed in this delivered build.

## Staff review design and the slides

The workflow takes inspiration from the current Assignment 8 slides, especially slide 19's scene-by-scene checks and preserved versions, and slide 21's visible creator status and gate before publication. It implements working records and permissions around those ideas. It does not claim that projected review-time savings, acceptance rates or other slide targets have been achieved.

The four implemented checks are proposed placeholders: identity; continuity/action/props/transitions; usable video/audio/pacing; and content/rights against draft rules. They are not official AIM.movie guidelines. The administrator can edit the draft text for future submissions. Every submission stores its own rule version. Automated prechecks verify readable video metadata only; no automated full-film moderation or rights verification is claimed. Uncertainty should lead to a change request, rejection, or escalation before approval.

An assembled submission includes copied constituent videos for staff to compare sequence context. A reviewer claims one item, records timecoded feedback, and either approves, requests local changes or rejects. The creator can send a new version linked to the old record. After staff approval, only the creator can publish it, with ownership still tied to the original account and project. Current review claims do not expire automatically; coordinate staff handoffs in this test version.

## Chat, captions and public profiles

In the conversation layer, **Enter sends** and **Shift+Enter inserts a new line**. Input-method composition is respected, so choosing characters in an IME does not accidentally submit a message. This applies only to the chat composer, not other text fields.

The assistant identifies itself as MIA; the site title, logo, API settings and staff organization still use AIM.movie. Existing message text is preserved. Reload the page and start a new live voice session to receive the updated assistant instructions.

Submission fields are separate:

- **Private notes to staff:** continuity problems, questions, context and review instructions. Visible to the creator and authorized reviewers only.
- **Public caption:** what viewers will read under the video after the creator publishes it. Optional, and visible to staff during review.

From Account or Share, **Edit public caption** creates a new review version using the same immutable video, without re-uploading or generating it. The existing post remains public until the new caption is approved and its creator publishes the replacement. Changing an approved caption directly during Publish is blocked. To hide an old caption immediately, unpublish the current post first.

Clicking a creator's name/avatar on Discover opens their public profile. Profiles show the display name, optional bio, published-video count, likes, and published creations. Email, account role, private projects, staff notes, drafts and approved-but-unpublished videos are excluded. Account includes an editor for your own public name/bio. Public profile URLs use stable account IDs, so changing the display name does not break them.

## Administration and migration

Use a separate extracted folder. Existing single-user `data/` is not automatically shared with all accounts. After registration, import it as a new private project using the README command. The old source directory remains intact. For this update and future updates to this multi-user version, preserve the **entire** existing `data/` directory, including `platform.sqlite`, account/project directories, community media and session secret, plus your `.env` and workflow changes.

To install this MIA/publication update, stop the server, extract the new ZIP into a separate folder, copy your existing entire `data/` and `.env` into the new app folder, and keep your custom workflow.json if changed. Install requirements if needed and start `python app.py`. Do not copy the old Python/static/template files over the new version. Refresh or hard-reload the browser so its JavaScript matches the upgraded server.

The first startup adds fields to the platform database. Existing accounts, password hashes, projects, original creator IDs, review history and reactions are retained. Previously published legacy posts stay published under their original creator and retain the caption that was already public; new private staff notes are never automatically promoted into a caption. A pre-upgrade platform database backup is saved as `data/platform_before_creator_publish_v2.sqlite` when upgrading an installation containing accounts. Preserve your own full-folder backup as well. No account re-registration or database deletion is needed. The PBKDF2 compatibility fix remains included.

To promote a registered account:

```bash
python manage.py set-role --email reviewer@example.com --role reviewer
```

To reset a forgotten password locally, without email recovery:

```bash
python manage.py reset-password --email creator@example.com
```

The command prompts privately for the password and revokes previous sessions. Do not put passwords or API keys in shell command arguments.

## What remains before an actual public launch

This test server binds to 127.0.0.1 and is meant for local evaluation. Real public deployment needs a production host, HTTPS, managed identity/email verification/recovery and optional MFA, approved AIM policy, scalable private media storage and backups, upload quotas, durable jobs/worker queues, malware and content review controls, reliable billing/quota enforcement, review claim handoff, and retention/deletion tools. Local account/password and server-side authorization are implemented, but they are not a replacement for that launch work.

For you currently ranks up to 500 approved posts using liked tags, reaction count, recency and previously viewed status. It is a transparent heuristic for trying the experience, not a trained recommender. There are no comments, follows, messaging, automatic notifications, recommendation training, real payment processing, email delivery, Content Credentials signing or automated policy enforcement. Account passwords are hashed; media is not encrypted at rest by this app.

## Sources

- OpenAI GPT-5.4 mini model/rates: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- OpenAI Realtime 2.1 mini model/rates: https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
- OpenAI API pricing, including transcription: https://developers.openai.com/api/docs/pricing
- WebRTC server-authenticated session setup: https://developers.openai.com/api/docs/guides/realtime-webrtc
- Realtime transcript events and interruption/truncation: https://developers.openai.com/api/docs/guides/realtime-conversations
- Project reference: user-supplied IT492_Assignment8.pptx, slides 19 and 21, inspected October 26, 2026.
