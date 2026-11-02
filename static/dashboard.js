'use strict';
const studioDisplay = {sort:'recent',view:'grid'};
try { studioDisplay.view=sessionStorage.getItem('aim-studio-view')==='list'?'list':'grid'; } catch {}

function studioIcon(name) {
  const paths={
    plus:'<path d="M12 5v14M5 12h14"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
    film:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.film}</svg>`;
}
function studioMovies() {
  if(S.dashboard)return S.dashboard.movies;
  // A saved workspace can render the dashboard while its summary refreshes.
  return (S.platform.projects||[]).map(p=>({id:p.id,title:p.id===S.platform.project_id?S.vision?.title||p.name:p.name,
    description:p.id===S.platform.project_id?S.vision?.logline||'A new story, ready for your direction.':'Your saved movie workspace.',
    stage:'Develop',next_step:'Continue your movie',action:'Continue your movie',updated:p.created,
    url:`/idea?project=${encodeURIComponent(p.id)}`,cover_url:null}));
}
function studioUpdated(value) {
  const date=new Date(value),elapsed=Math.max(0,Date.now()-date.getTime());
  if(!Number.isFinite(elapsed))return 'Saved in your studio';
  const minutes=Math.floor(elapsed/60000),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
  return minutes<1?'Updated just now':minutes<60?`Updated ${minutes}m ago`:hours<24?`Updated ${hours}h ago`:days<7?`Updated ${days}d ago`:`Updated ${date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
}
function studioArtwork(movie,featured=false) {
  if(movie.cover_url)return `<img class="${featured?'studio-featured-image':'studio-movie-image'}" src="${esc(movie.cover_url)}" alt="" ${featured?'fetchpriority="high"':'loading="lazy"'}>`;
  const tone=[...movie.id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%4;
  return `<div class="studio-art-placeholder studio-art-tone-${tone}" aria-hidden="true"><div class="studio-art-orbit"></div>${studioIcon('film')}</div>`;
}
function studioDashboardPage() {
  const movies=studioMovies(),featured=movies.find(p=>p.id===S.platform.project_id)||movies[0];
  const ordered=[...movies].sort((a,b)=>studioDisplay.sort==='title'?a.title.localeCompare(b.title):
    studioDisplay.sort==='oldest'?new Date(a.updated)-new Date(b.updated):new Date(b.updated)-new Date(a.updated));
  const newButton=`<button class="button primary studio-new-button" data-action="new-project">${studioIcon('plus')}<span>New movie</span></button>`;
  return `<section class="studio-dashboard-content" aria-labelledby="studio-dashboard-title">
    <div class="studio-dashboard-heading"><h1 id="studio-dashboard-title">My Studio</h1>${newButton}</div>
    ${featured?`<article class="studio-featured ${featured.cover_url?'has-cover':'no-cover'}">
      <div class="studio-featured-art">${studioArtwork(featured,true)}</div><div class="studio-featured-shade"></div>
      <div class="studio-featured-content"><div class="studio-kicker">Continue your movie<span></span></div>
        <h2>${esc(featured.title)}</h2><p class="studio-featured-description">${esc(featured.description)}</p>
        <div class="studio-featured-meta"><span>${studioIcon('layers')}<span>Current stage: <strong>${esc(featured.stage)}</strong></span></span><span>${studioIcon('target')}<span>Next step: <strong>${esc(featured.next_step)}</strong></span></span></div>
        <a class="button primary studio-continue-button" href="${esc(featured.url)}">${esc(featured.action)}${studioIcon('arrow')}</a>
      </div></article>`:`<section class="studio-featured studio-welcome"><div class="studio-featured-art">${studioArtwork({id:'new'})}</div><div class="studio-featured-shade"></div><div class="studio-featured-content"><div class="studio-kicker">Your next story starts here<span></span></div><h2>Make something<br>worth watching.</h2><p class="studio-featured-description">Start with an idea. Build your cast, shape your story, and bring your movie to life with MIA.</p>${newButton}</div></section>`}
    <section class="studio-movies-section" aria-labelledby="studio-movies-title"><div class="studio-movies-heading"><h2 id="studio-movies-title">Your movies</h2>
      <div class="studio-library-controls"><label for="studio-sort">Sort by:<select id="studio-sort"><option value="recent" ${studioDisplay.sort==='recent'?'selected':''}>Recent</option><option value="oldest" ${studioDisplay.sort==='oldest'?'selected':''}>Oldest</option><option value="title" ${studioDisplay.sort==='title'?'selected':''}>Title A–Z</option></select></label>
        <div class="studio-view-controls" role="group" aria-label="Movie layout">${['grid','list'].map(view=>`<button class="${studioDisplay.view===view?'active':''}" data-action="studio-view" data-view="${view}" aria-label="${view==='grid'?'Grid':'List'} view" aria-pressed="${studioDisplay.view===view}">${studioIcon(view)}</button>`).join('')}</div></div></div>
      <div class="studio-movie-grid ${studioDisplay.view==='list'?'is-list':''}">${ordered.map(movie=>`<a class="studio-movie-card ${featured?.id===movie.id?'is-current':''}" href="${esc(movie.url)}" aria-label="Open ${esc(movie.title)}"><div class="studio-movie-cover">${studioArtwork(movie)}</div><div class="studio-movie-copy"><h3>${esc(movie.title)}</h3><p>${esc(movie.description)}</p><div class="studio-movie-footer"><span>${studioIcon('layers')}${esc(movie.stage)}</span><time datetime="${esc(movie.updated||'')}">${esc(studioUpdated(movie.updated))}</time></div></div></a>`).join('')}
        <button class="studio-new-card" data-action="new-project"><span class="studio-new-symbol">${studioIcon('plus')}</span><strong>New movie</strong><span>Start a new project</span></button>
      </div>${!movies.length?'<p class="studio-empty-note">Your movies will appear here as you create them.</p>':''}</section></section>`;
}
function studioDashboardAction(action,element) {
  if(action!=='studio-view')return false;
  studioDisplay.view=element.dataset.view==='list'?'list':'grid';
  try { sessionStorage.setItem('aim-studio-view',studioDisplay.view); } catch {}
  render();document.querySelector(`[data-action="studio-view"][data-view="${studioDisplay.view}"]`)?.focus();
  return true;
}
