'use strict';

const AIMStaffReview = (() => {
  const tabs = [
    ['submitted', 'Needs review', 'The queue is clear. New submissions will appear here.'],
    ['in_review', 'In review', 'There are no claimed submissions in this view.'],
    ['reported', 'Reported', 'There are no open viewer reports.'],
  ];
  const statusLabels = {
    submitted: 'Needs review', in_review: 'In review', check_pending: 'Check pending',
    approved: 'Approved', published: 'Published', rejected: 'Rejected',
    changes_requested: 'Changes requested', withdrawn: 'Withdrawn',
    taken_down: 'Removed', superseded: 'Replaced',
  };
  const checkStates = {
    clear: ['clear', 'No flags found', 'The automatic check found no flags.'],
    flagged: ['flagged', 'Policy flag', 'Review the findings before deciding.'],
    pending: ['pending', 'Check pending', 'Checking the submitted video and public details.'],
    unavailable: ['neutral', 'Incomplete check', 'This submission needs a staff decision.'],
    file_problem: ['flagged', 'Video needs changes', 'The creator can send a new version.'],
    withdrawn: ['neutral', 'Withdrawn', 'The creator withdrew this submission.'],
  };
  const kindLabels = {clip: 'Clip', scene: 'Scene', movie: 'Finished cut'};
  const relativeDate = new Intl.RelativeTimeFormat(undefined, {style: 'short'});
  let selectedId = new URLSearchParams(location.search).get('submission');
  let tab, assignment = 'all', queue, thumbnails, loadVersion = 0, dirty = false;
  let byId = new Map(), byReport = new Map();

  function status(item) {
    return `<span class="staff-status" data-status="${pe(item.status)}">${pe(statusLabels[item.status] || AIMPublication.status(item))}</span>`;
  }

  function age(when) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(when)) / 60000));
    if (!Number.isFinite(minutes)) return '';
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return relativeDate.format(-minutes, 'minute');
    if (minutes < 1440) return relativeDate.format(-Math.floor(minutes / 60), 'hour');
    return relativeDate.format(-Math.floor(minutes / 1440), 'day');
  }

  function submittedAt(when) {
    return new Date(when).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  }

  function group(key) {
    if (key === 'reported') {
      return Array.from(byReport.keys(), id => byId.get(id)).filter(Boolean);
    }
    return queue.items.filter(item => item.status === key);
  }

  function itemTab(item) {
    if (item.status === 'published' && byReport.has(item.id)) return 'reported';
    if (item.status === 'submitted' || item.status === 'in_review') return item.status;
  }

  function listedItems() {
    const items = group(tab);
    if (tab !== 'in_review') return items;
    const mine = item => item.reviewer_id === P.auth.user.id;
    if (assignment === 'mine') return items.filter(mine);
    if (assignment === 'others') return items.filter(item => !mine(item));
    return [...items.filter(mine), ...items.filter(item => !mine(item))];
  }

  function thumb(url) {
    return `<span class="staff-thumb" aria-hidden="true">
      ${AIMIcons.svg('play')}
      ${url ? `<video data-review-thumb="${pe(url)}#t=0.1" muted playsinline preload="metadata" tabindex="-1"></video>` : ''}
    </span>`;
  }

  function loadThumbnails() {
    thumbnails?.disconnect();
    const videos = pm().querySelectorAll('[data-review-thumb]');
    const attach = video => {
      video.onloadeddata = () => video.classList.add('has-frame');
      video.src = video.dataset.reviewThumb;
    };
    if (!('IntersectionObserver' in window)) {
      Array.from(videos).slice(0, 16).forEach(attach);
      return;
    }
    thumbnails = new IntersectionObserver(entries => {
      for (const {target: video, isIntersecting} of entries) {
        if (!video.isConnected) continue;
        if (isIntersecting && !video.hasAttribute('src')) attach(video);
        if (!isIntersecting && video.hasAttribute('src')) {
          video.classList.remove('has-frame');
          video.removeAttribute('src');
          video.load();
        }
      }
    });
    videos.forEach(video => thumbnails.observe(video));
  }

  function queueCard(item) {
    const current = item.id === selectedId && byId.has(item.id);
    const ownClaim = item.status === 'in_review' && item.reviewer_id === P.auth.user.id;
    const count = byReport.get(item.id)?.length || 0;
    return `<button type="button" class="staff-queue-item" data-act="review-select" data-id="${pe(item.id)}" aria-pressed="${current}">
      ${thumb(item.screening?.verdict === 'file_problem' ? null : item.video_url)}
      <span class="staff-queue-copy">
        <strong>${pe(item.title)}</strong>
        ${item.author ? `<span>${pe(item.author)} · ${pe(kindLabels[item.kind] || item.kind)}</span>` : ''}
        ${ownClaim ? '<span class="staff-queue-assigned">Assigned to you</span>' : ''}
        ${item.status === 'in_review' && !ownClaim && item.reviewer_name ? `<span>Assigned to ${pe(item.reviewer_name)}</span>` : ''}
      </span>
      <span class="staff-queue-foot">
        ${tab === 'reported' ? `<span>${count} ${count === 1 ? 'report' : 'reports'}</span>` :
          item.screening?.verdict === 'flagged' ? '<span class="staff-queue-flag">Policy flag</span>' : '<span></span>'}
        ${item.created ? `<time datetime="${pe(item.created)}" title="${pe(submittedAt(item.created))}">${pe(age(item.created))}</time>` : ''}
      </span>
    </button>`;
  }

  function queueMarkup(items) {
    const tabButton = ([key, label]) => {
      const count = group(key).length;
      return `<button type="button" data-act="review-tab" data-tab="${key}" aria-pressed="${tab === key}">
        ${label}${count ? `<span>${count}</span>` : ''}
      </button>`;
    };
    return `<aside class="staff-panel staff-review-queue" aria-labelledby="staff-queue-title">
      <div class="staff-queue-head">
        <h2 id="staff-queue-title">Review queue</h2>
        <button type="button" class="staff-refresh" data-act="review-refresh" aria-label="Refresh review queue" title="Refresh review queue">↻</button>
      </div>
      <nav class="staff-queue-tabs" aria-label="Review queue filters">
        ${tabs.map(tabButton).join('')}
      </nav>
      ${tab === 'in_review' ? `<select id="staff-review-assignment" aria-label="Filter by reviewer">
        ${[['all', 'All reviewers'], ['mine', 'Assigned to me'], ['others', 'Assigned to others']]
          .map(([key, label]) => `<option value="${key}" ${assignment === key ? 'selected' : ''}>${label}</option>`).join('')}
      </select>` : ''}
      <div class="staff-queue-list" aria-label="Submissions">${items.map(queueCard).join('') ||
        `<p class="staff-muted staff-queue-empty">${pe(tabs.find(([key]) => key === tab)[2])}</p>`}</div>
    </aside>`;
  }

  function caption(item) {
    return `<section class="staff-caption">
      <h3>Public caption</h3>
      <p class="staff-muted preserve-lines">${pe(item.public_caption || 'No public caption provided.')}</p>
      ${item.tags?.length ? `<div class="staff-tags">${item.tags.map(tag => `<span>#${pe(tag)}</span>`).join('')}</div>` : ''}
    </section>`;
  }

  function clipContext(item) {
    const segments = item.metadata?.context || [];
    if (!segments.length || item.screening?.verdict === 'file_problem') return '';
    const tile = (source, label, isMain = false) => `<button type="button" class="staff-context-clip" data-act="review-source"
      data-source="${pe(source)}" data-label="${pe(label)}" aria-pressed="${isMain}">${thumb(source)}<span>${pe(label)}</span></button>`;
    return `<section class="staff-context">
      <h3>Clip context</h3>
      <div class="staff-context-list">
        ${tile(item.video_url, 'Submitted video', true)}
        ${segments.map((segment, index) => tile('/api/review/' + encodeURIComponent(item.id) + '/context/' + encodeURIComponent(segment.index), 'Segment ' + (index + 1))).join('')}
      </div>
    </section>`;
  }

  function automaticChecks(item) {
    const check = item.screening;
    const [tone, label, fallback] = checkStates[check?.verdict] ||
      ['neutral', 'Manual review', 'Staff review applies to this submission.'];
    const findings = check?.evidence || [];
    const coverage = ['Video', ...(item.metadata?.has_audio ? ['Audio'] : []), 'Public text'];
    return `<section class="staff-panel staff-checks" aria-labelledby="staff-checks-title">
      <div class="staff-check-head">
        <div class="staff-check-icon" data-tone="${tone}" aria-hidden="true">${{clear: '✓', flagged: '!', pending: '…', neutral: '–'}[tone]}</div>
        <div>
          <h2 id="staff-checks-title">Automatic checks</h2>
          <p class="staff-muted">${pe(check?.reason || fallback)}</p>
        </div>
        <span class="staff-status" data-tone="${tone}">${label}</span>
      </div>
      ${check?.verdict === 'clear' ? `<ul class="staff-coverage" aria-label="Completed checks">
        ${coverage.map(part => `<li><span aria-hidden="true">✓</span> ${part}</li>`).join('')}
      </ul>` : ''}
      ${findings.length ? `<ul class="staff-findings" aria-label="Moderation findings">${findings.map(finding => {
        const seconds = finding.seconds;
        const time = Number.isFinite(seconds) ? Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0') : null;
        return `<li>
          <div><small>${pe(finding.source)}</small><strong>${pe(String(finding.label || '').replaceAll('_', ' '))}</strong></div>
          ${time !== null ? `<button type="button" class="staff-timecode" data-act="review-jump" data-seconds="${seconds}" aria-label="Jump to ${time}">${AIMIcons.svg('play')} ${time}</button>` : ''}
        </li>`;
      }).join('')}</ul>` : ''}
    </section>`;
  }

  function details(item) {
    const meta = item.metadata || {};
    const fields = [
      ['Duration', Number.isFinite(meta.duration_seconds) ? `${meta.duration_seconds.toFixed(1)} s` : ''],
      ['Dimensions', meta.width && meta.height ? `${meta.width} × ${meta.height}` : ''],
      ['Frame rate', meta.fps ? `${meta.fps} fps` : ''],
      ['Audio', typeof meta.has_audio === 'boolean' ? (meta.has_audio ? 'Present' : 'Silent') : ''],
      ['Source project', item.project_name],
    ].filter(([, value]) => value);
    return `<details class="staff-panel staff-disclosure">
      <summary>Review history</summary>
      <ol class="staff-history">${(item.history || []).map(entry => `<li>
        <div><strong>${pe(entry.action.replaceAll('_', ' '))}</strong><time datetime="${pe(entry.created)}">${pe(submittedAt(entry.created))}</time></div>
        <span class="staff-muted">${pe(entry.actor_name || 'Staff / creator')}</span>
        ${entry.note ? `<p class="preserve-lines">${pe(entry.note)}</p>` : ''}
      </li>`).join('') || '<li class="staff-muted">No review events recorded.</li>'}</ol>
    </details>
    <details class="staff-panel staff-disclosure">
      <summary>Technical details</summary>
      <dl class="staff-technical">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${pe(value)}</dd></div>`).join('')}</dl>
      ${meta.technical_precheck ? `<p class="staff-muted">${pe(meta.technical_precheck)}</p>` : ''}
    </details>`;
  }

  function center(item) {
    const context = clipContext(item);
    const reports = byReport.get(item.id) || [];
    return `<div class="staff-review-center">
      <article class="staff-panel staff-preview">
        <div class="staff-preview-head">
          <div><h2 tabindex="-1" id="staff-review-title">${pe(item.title)}</h2>
            <p class="staff-muted">${pe(item.author)} · ${pe(kindLabels[item.kind] || item.kind)} · ${item.parent_id ? 'Revised version' : 'Version 1'}</p>
          </div>
          <div class="staff-preview-meta">${status(item)}
            <time datetime="${pe(item.created)}">Submitted ${pe(submittedAt(item.created))}</time>
          </div>
        </div>
        ${item.screening?.verdict === 'file_problem' ? '<p class="staff-video-unavailable">This video needs a new submission.</p>' :
          `<video id="staff-review-video" src="${pe(item.video_url)}" controls playsinline preload="metadata" aria-label="Submitted video"></video>`}
        <div class="staff-preview-context ${context ? 'has-context' : ''}">${context}${caption(item)}</div>
      </article>
      ${automaticChecks(item)}
      ${reports.length ? `<section class="staff-panel staff-reports"><h2>Viewer reports <span>${reports.length}</span></h2>
        <ul>${reports.map(report => `<li class="preserve-lines">${pe(report.reason)}</li>`).join('')}</ul>
      </section>` : ''}
      ${details(item)}
    </div>`;
  }

  function checklist(item, assigned) {
    return `<section class="staff-rail-section">
      <h2>Submission checklist</h2>
      <div class="staff-rule-version"><span>${pe(item.policy.version)}</span><button type="button" class="staff-text-button" data-act="review-rules" data-scope="submission">View rules</button></div>
      <div class="staff-checklist">${item.policy.criteria.map(criterion => {
        const checked = item.checks?.[criterion.id] === true;
        return assigned ? `<label><input form="decision-form" type="checkbox" name="${pe(criterion.id)}">${pe(criterion.label)}</label>` :
          `<div><span class="staff-checklist-mark" data-checked="${checked}" aria-label="${checked ? 'Checked' : 'Unchecked'}">${checked ? '✓' : ''}</span>${pe(criterion.label)}</div>`;
      }).join('')}
      ${assigned ? '<label class="staff-checklist-ack"><input form="decision-form" type="checkbox" name="acknowledge_draft">I’ve reviewed the provisional rules.</label>' : ''}
      </div>
    </section>`;
  }

  function decision(item, assigned, own) {
    if (assigned) {
      return `<section class="staff-panel staff-decision">
        <h2>Decision</h2>
        <p class="staff-muted">Approval lets the creator preview and publish this version.</p>
        <form id="decision-form" class="portal-form">
          <p class="staff-form-error" id="form-error" role="alert"></p>
          <button type="submit" class="button primary" name="decision" value="approved">Approve submission</button>
          <button type="submit" class="button secondary" name="decision" value="changes_requested">Request changes</button>
          <button type="submit" class="button staff-reject" name="decision" value="rejected">Reject submission</button>
          <details class="staff-decision-note"><summary>Add a review note</summary>
            <label>Feedback and timecodes<textarea name="note" maxlength="3000" rows="3" placeholder="Explain what the creator can fix."></textarea></label>
          </details>
          <button type="button" class="staff-text-button staff-release" data-act="review-release">Release review</button>
        </form>
      </section>`;
    }
    if (item.status === 'submitted' && !own) {
      return `<section class="staff-panel staff-decision">
        <h2>Decision</h2>
        <p class="staff-muted">Claim the submission to complete the checklist and make a decision.</p>
        <button type="button" class="button primary" data-act="review-claim">Claim for review</button>
      </section>`;
    }
    if (item.status !== 'published') return '';
    return `<section class="staff-panel staff-decision">
      <h2>Reported post</h2>
      <p class="staff-muted">${own ? 'Another staff member can review this report.' : 'This version is live on Discover.'}</p>
      ${!own ? `<form id="keep-published-form" class="portal-form">
        <label>Review note<textarea name="note" maxlength="3000" required></textarea></label>
        <button type="submit" class="button secondary">Resolve reports and keep published</button>
      </form>
      <details class="staff-decision-note">
        <summary>Remove post</summary>
        <form id="takedown-form" class="portal-form">
          <label>Reason<textarea name="note" maxlength="3000" required></textarea></label>
          <button type="submit" class="button danger">Remove from Discover</button>
        </form>
      </details>` : ''}
    </section>`;
  }

  function sidebar(item) {
    const user = P.auth.user;
    const own = item.user_id === user.id;
    const assigned = !own && item.status === 'in_review' && item.reviewer_id === user.id;
    const heading = assigned ? 'Assigned to you' : item.status === 'in_review' ? 'Assigned reviewer' : 'Assignment';
    const description = assigned ? 'You’re reviewing this version.' :
      item.status === 'in_review' ? (item.reviewer_name || 'Another staff member') :
      item.status === 'submitted' ? (own ? 'Another staff member can review your submission.' : 'Available to claim') :
      item.status === 'check_pending' ? 'Waiting for automatic checks' :
      item.reviewer_name ? 'Reviewed by ' + item.reviewer_name :
      item.screening?.automatic ? 'Cleared by automatic checks' : statusLabels[item.status] || 'Staff review';
    return `<aside class="staff-review-sidebar" aria-label="Review assignment and decision">
      <div class="staff-panel staff-review-assignment">
        <section class="staff-rail-section">
          <h2>${heading}</h2>
          <p class="staff-assignee staff-muted">${assigned ? avatarMarkup(user.avatar_url, user.name) : ''}${pe(description)}</p>
        </section>
        ${checklist(item, assigned)}
        <section class="staff-rail-section">
          <h2>Creator’s note to reviewers</h2>
          <p class="staff-note preserve-lines">${pe(item.review_notes || 'No private note provided.')}</p>
        </section>
      </div>
      ${decision(item, assigned, own)}
    </aside>`;
  }

  function showRules(scope) {
    const submission = scope === 'submission';
    const policy = submission ? byId.get(selectedId)?.policy : queue.policy;
    if (!policy) return;
    const dialog = document.querySelector('#staff-rules');
    dialog.innerHTML = `<div class="staff-dialog-head">
      <div><h2 id="staff-rules-title">${submission ? 'Rules for this submission' : 'Review rules'}</h2><span class="staff-muted">${pe(policy.version)}</span></div>
      <button type="button" class="staff-text-button" data-act="review-close-rules" aria-label="Close review rules">Close</button>
    </div>
    <p class="preserve-lines">${pe(policy.rules)}</p>
    ${submission ? '' : portalAdmin(`<details class="staff-disclosure">
      <summary>Edit rules for future submissions</summary>
      <form id="policy-form" class="portal-form">
        <label>Provisional rules<textarea name="rules" rows="6" minlength="20" maxlength="12000" required>${pe(policy.rules)}</textarea></label>
        <button type="submit" class="button secondary">Save new draft rules</button>
      </form>
    </details>`)}`;
    dialog.showModal();
  }

  function render({resetScroll = false} = {}) {
    const items = listedItems();
    const queueScroll = resetScroll ? 0 : pm().querySelector('.staff-queue-list')?.scrollTop || 0;
    if (!items.some(item => item.id === selectedId)) selectedId = items[0]?.id;
    const selected = byId.get(selectedId);
    pm().querySelector('#staff-review-video')?.pause();
    pm().innerHTML = `<header class="staff-review-heading">
      <div><h1>Staff review</h1><p class="staff-muted">Review submissions, check context, and make a decision.</p></div>
      <button type="button" class="staff-text-button" data-act="review-rules">Review rules</button>
    </header>
    <div class="staff-review-workspace">
      ${queueMarkup(items)}
      ${selected ? center(selected) + sidebar(selected) : `<div class="staff-panel staff-review-empty">
        <h2>${items.length ? 'Select a submission' : 'No submissions in this view'}</h2>
        <p class="staff-muted">${items.length ? 'Open a queue item to view its video and review details.' : 'Switch queue filters to see other submissions.'}</p>
      </div>`}
    </div>
    <dialog id="staff-rules" class="staff-rules-dialog" aria-labelledby="staff-rules-title"></dialog>`;
    pm().querySelector('.staff-queue-list').scrollTop = queueScroll;
    loadThumbnails();
  }

  function mayRefresh() {
    const player = document.querySelector('#staff-review-video');
    return !dirty && !P.working && !document.querySelector('#staff-rules')?.open && (!player || player.paused);
  }

  async function load({quiet = false} = {}) {
    if (quiet && !mayRefresh()) return;
    const version = ++loadVersion;
    const result = await req('review/queue?selected=' + encodeURIComponent(selectedId || ''));
    if (version !== loadVersion || (quiet && !mayRefresh())) return;
    if (quiet && JSON.stringify(result) === JSON.stringify(queue)) return;
    queue = result;
    byId = new Map(queue.items.map(item => [item.id, item]));
    byReport = new Map();
    for (const report of queue.reports) {
      if (!byReport.has(report.submission_id)) byReport.set(report.submission_id, []);
      byReport.get(report.submission_id).push(report);
    }
    const item = byId.get(selectedId);
    if (item && (!tab || !group(tab).some(row => row.id === item.id))) tab = itemTab(item);
    if (!tab) tab = tabs.find(([key]) => group(key).length)?.[0] || 'submitted';
    render();
  }

  function discardDraft() {
    if (dirty && !window.confirm('Discard your unsaved review notes and checklist?')) return false;
    dirty = false;
    return true;
  }

  function selectSource(source, label, seconds) {
    const player = document.querySelector('#staff-review-video');
    if (!player) return;
    if (player.getAttribute('src') !== source) player.src = source;
    player.setAttribute('aria-label', label);
    for (const clip of pm().querySelectorAll('[data-act="review-source"]')) {
      clip.setAttribute('aria-pressed', String(clip.dataset.source === source));
    }
    if (Number.isFinite(seconds)) {
      player.currentTime = seconds;
      player.focus();
    }
  }

  async function action(name, element) {
    const item = byId.get(selectedId);
    if (name === 'review-select' && (element.dataset.id !== selectedId || !item)) {
      if (!discardDraft()) return;
      selectedId = element.dataset.id;
      if (byId.has(selectedId)) render();
      else await load();
      if (matchMedia('(max-width: 720px)').matches) document.querySelector('#staff-review-title')?.focus();
      else pm().querySelector('[data-act="review-select"][aria-pressed="true"]')?.focus({preventScroll: true});
    } else if (name === 'review-tab' && element.dataset.tab !== tab) {
      if (!discardDraft()) return;
      tab = element.dataset.tab;
      render({resetScroll: true});
      pm().querySelector('[data-act="review-tab"][aria-pressed="true"]')?.focus();
    } else if (name === 'review-refresh') {
      if (discardDraft()) await load();
    } else if (name === 'review-source') {
      selectSource(element.dataset.source, element.dataset.label);
    } else if (name === 'review-jump' && item) {
      selectSource(item.video_url, 'Submitted video', Number(element.dataset.seconds));
    } else if (name === 'review-rules') {
      showRules(element.dataset.scope);
    } else if (name === 'review-close-rules') {
      document.querySelector('#staff-rules').close();
    } else if (item && (name === 'review-claim' || name === 'review-release')) {
      if (name === 'review-release' && !discardDraft()) return;
      await req('review/' + encodeURIComponent(item.id) + (name === 'review-claim' ? '/claim' : '/release'), {});
      await load();
      if (name === 'review-release') say('Review released to the queue.');
    }
  }

  async function submit(form, values, submitter) {
    if (form.id === 'policy-form') {
      await req('review/policy', values);
      await load();
      say('New draft rules saved for future submissions.');
      return;
    }
    const item = byId.get(selectedId);
    if (!item) return;
    const path = 'review/' + encodeURIComponent(item.id);
    if (form.id === 'decision-form') {
      const choice = submitter?.value;
      const checks = Object.fromEntries(item.policy.criteria.map(criterion => [criterion.id, !!form.elements[criterion.id]?.checked]));
      const acknowledged = form.elements.acknowledge_draft.checked;
      form.querySelector('#form-error').textContent = '';
      if (choice === 'approved') {
        const incomplete = item.policy.criteria.find(criterion => !checks[criterion.id]);
        if (incomplete || !acknowledged) {
          (incomplete ? form.elements[incomplete.id] : form.elements.acknowledge_draft).focus();
          throw new Error('Complete the submission checklist before approving.');
        }
      } else if (['changes_requested', 'rejected'].includes(choice)) {
        if (!values.note?.trim()) {
          form.querySelector('.staff-decision-note').open = true;
          form.elements.note.focus();
          throw new Error('Add a review note explaining your decision.');
        }
      } else return;
      await req(path + '/decision', {decision: choice, note: values.note, checks, acknowledge_draft: acknowledged});
      say('Review decision saved.');
    } else if (form.id === 'keep-published-form') {
      const reports = (byReport.get(item.id) || []).map(({id, reason, created}) => ({id, reason, created}));
      await req(path + '/keep-published', {reports, note: values.note});
      say('Publication review saved.');
    } else if (form.id === 'takedown-form') {
      await req(path + '/decision', {decision: 'taken_down', note: values.note});
      say('Removal saved.');
    } else return;
    dirty = false;
    await load();
  }

  document.addEventListener('input', event => {
    if (['decision-form', 'takedown-form', 'keep-published-form'].includes(event.target.form?.id)) dirty = true;
  });
  document.addEventListener('change', event => {
    if (event.target.id !== 'staff-review-assignment') return;
    if (!discardDraft()) {
      event.target.value = assignment;
      return;
    }
    assignment = event.target.value;
    render({resetScroll: true});
    document.querySelector('#staff-review-assignment')?.focus();
  });
  document.addEventListener('aim:resume', () => {
    if (queue) load({quiet: true}).catch(() => {});
  });

  return {load, action, submit};
})();
