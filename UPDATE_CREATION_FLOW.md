# AIM.movie creation flow update

Apply this combined update instead of the earlier pending Reference Flow Fix, Discover Landing Fix and Studio Dashboard Update ZIPs. It includes those changes and the new conversation and adaptation screens.

1. Extract this ZIP.
2. Upload its contents to the matching locations in your existing GitHub repository. Preserve the `static`, `templates` and `tests` folders. Add the new files as well as replacing existing ones.
3. Commit the changes and let Render redeploy. Refresh the site after deployment.

The conversation now uses a direct reply with an inline thinking indicator. Creative briefs, source analysis and video jobs keep their saved background progress. Generation history has been removed from navigation; active jobs link directly to their project.

The welcome screen offers Describe an idea, Adapt a story, Surprise me and Create a scene. After the conversation starts, the sidebar displays the movie details identified so far. Its details come from the same typed reply, without another model request. Existing conversations acquire these notes on the next typed reply. Live voice keeps its existing conversation and transcript behavior, and those transcripts remain available when building the brief.

For a book or script, choose Adapt a story, import the file, select excerpts and add your direction. Build creative brief works directly from that source; a conversation is optional. Story analysis, a story bible and discussing the source with MIA remain available. The Studio dashboard can resume a source-based movie in the adaptation workspace.

The package also includes the project dashboard, clickable profile picture, Discover landing page, character reference choices, clip-ready notifications and saved-video status repairs from the pending updates. The generation-time estimate remains commented out until you supply measurements.

Validation used 274 Python tests, four frontend suites, and desktop/mobile browser checks with synthetic project data and mocked provider responses.
