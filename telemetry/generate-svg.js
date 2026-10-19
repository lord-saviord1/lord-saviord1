#!/usr/bin/env node
// Renders assets/telemetry.svg from telemetry/data.json (written by generate-telemetry.js).
// Also asks GitHub for the account's public repo count (one small API call). If that call
// fails, the counter shows an em dash instead and everything else still renders.
//
// Usage:  node telemetry/generate-svg.js            (from the repo root)
// Needs:  Node 18+ (global fetch). No dependencies.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'telemetry', 'data.json');
const outPath = path.join(root, 'assets', 'telemetry.svg');

const C = {
  bg: '#0d1410', bar: '#0a100c', line: '#1f2e24', text: '#cfe3d3',
  dim: '#6f8a76', gold: '#f2c94c', green: '#5fd38d', panel: '#101a14'
};
const FONT = `Consolas, 'Cascadia Mono', SFMono-Regular, Menlo, 'Liberation Mono', 'Courier New', monospace`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function getPublicRepoCount(owner) {
  try {
    const headers = { 'User-Agent': 'telemetry-svg', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/users/${owner}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return Number.isFinite(json.public_repos) ? String(json.public_repos) : '—';
  } catch (err) {
    console.warn(`Could not read public repo count (${err.message}); showing an em dash.`);
    return '—';
  }
}

async function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const projects = Array.isArray(data.projects) ? data.projects.filter(p => p.status === 'ok') : [];
  const langs = Array.isArray(data.language_telemetry) ? data.language_telemetry : [];

  const owner = String(data.source_profile_repository || process.env.GITHUB_REPOSITORY || '').split('/')[0] || 'lord-saviord1';
  const publicRepos = process.env.PUBLIC_REPOS_OVERRIDE || await getPublicRepoCount(owner);

  const featured = `${data.successful_project_count ?? projects.length}/${data.project_count ?? projects.length}`;
  const windowDays = data.recent_commit_window_days || 30;
  const totalRecent = projects.reduce((n, p) => n + (p.recent_commit_count || 0), 0);
  const liveCount = projects.filter(p => p.deployment_url).length;
  const synced = data.last_updated ? String(data.last_updated).slice(0, 10) : 'n/a';

  const shortName = repo => { const n = String(repo).split('/').pop(); return n.length > 23 ? n.slice(0, 22) + '…' : n; };

  // ---- layout ----
  const W = 880;
  const topRows = projects.slice().sort((a, b) => (b.recent_commit_count || 0) - (a.recent_commit_count || 0)).slice(0, 8);
  const maxCommits = Math.max(1, ...topRows.map(p => p.recent_commit_count || 0));
  const langRows = langs.slice(0, 6);
  const rowH = 26;
  const panelTop = 168;
  const rows = Math.max(topRows.length, langRows.length, 1);
  const H = panelTop + 34 + rows * rowH + 46;

  const counters = [
    ['PUBLIC REPOS', publicRepos],
    ['FEATURED PROJECTS', featured],
    [`COMMITS · LAST ${windowDays}D`, String(totalRecent)],
    ['FEATURED WITH LIVE URL', String(liveCount)],
  ];
  const cw = (W - 40 - 3 * 12) / 4;
  const counterEls = counters.map(([k, v], i) => {
    const x = 20 + i * (cw + 12);
    return `<g class="ap" style="animation-delay:${0.1 + i * 0.12}s">
  <rect x="${x}" y="58" width="${cw}" height="84" rx="6" fill="${C.panel}" stroke="${C.line}"/>
  <text x="${x + 14}" y="82" fill="${C.dim}" style="font-size:10.5px;letter-spacing:.08em">${esc(k)}</text>
  <text x="${x + 14}" y="124" fill="${C.gold}" style="font-size:${v.length > 6 ? 24 : 34}px;font-weight:700">${esc(v)}</text>
</g>`;
  }).join('\n');

  const leftX = 20, colW = (W - 40 - 20) / 2, rightX = 20 + colW + 20;
  const barMax = colW - 225;

  const activityEls = topRows.map((p, i) => {
    const y = panelTop + 34 + i * rowH;
    const n = p.recent_commit_count || 0;
    const w = Math.max(n > 0 ? 3 : 0, Math.round((n / maxCommits) * barMax));
    return `<g>
  <text x="${leftX + 14}" y="${y + 14}" fill="${C.text}" style="font-size:12px">${esc(shortName(p.repo))}</text>
  <rect x="${leftX + 180}" y="${y + 3}" width="${barMax}" height="14" rx="2" fill="${C.line}" fill-opacity=".5"/>
  <rect class="bar" style="animation-delay:${0.5 + i * 0.07}s" x="${leftX + 180}" y="${y + 3}" width="${w}" height="14" rx="2" fill="${C.green}"/>
  <text x="${leftX + 180 + barMax + 10}" y="${y + 14}" fill="${C.gold}" style="font-size:12px;font-weight:700">${n}</text>
</g>`;
  }).join('\n');

  const langBarMax = colW - 190;
  const langEls = langRows.map((l, i) => {
    const y = panelTop + 34 + i * rowH;
    const pct = Number(l.percentage) || 0;
    const w = Math.max(pct > 0 ? 3 : 0, Math.round((pct / 100) * langBarMax));
    return `<g>
  <text x="${rightX + 14}" y="${y + 14}" fill="${C.text}" style="font-size:12px">${esc(l.language)}</text>
  <rect x="${rightX + 110}" y="${y + 3}" width="${langBarMax}" height="14" rx="2" fill="${C.line}" fill-opacity=".5"/>
  <rect class="bar" style="animation-delay:${0.6 + i * 0.07}s" x="${rightX + 110}" y="${y + 3}" width="${w}" height="14" rx="2" fill="${C.gold}"/>
  <text x="${rightX + 110 + langBarMax + 10}" y="${y + 14}" fill="${C.green}" style="font-size:12px;font-weight:700">${pct.toFixed(1)}%</text>
</g>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub telemetry: ${esc(publicRepos)} public repositories, ${esc(featured)} featured projects scanned, ${totalRecent} commits in the last ${windowDays} days across them, ${liveCount} featured projects with a live URL, last synced ${esc(synced)}.">
<title>GitHub telemetry for ${esc(owner)}</title>
<style>
  text{font-family:${FONT};font-size:12px}
  .ap{animation:ap .5s ease-out both}
  @keyframes ap{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .bar{transform-box:fill-box;transform-origin:0 50%;animation:grow .8s cubic-bezier(.2,.7,.2,1) both}
  @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .blink{animation:blink 1.1s steps(1,end) infinite}
  @keyframes blink{0%{opacity:1}50%{opacity:0}}
  @media (prefers-reduced-motion:reduce){.ap,.bar,.blink{animation:none}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="8" fill="${C.bg}" stroke="${C.line}"/>
<path d="M.5 8.5a8 8 0 0 1 8-8h${W - 17}a8 8 0 0 1 8 8V34H.5z" fill="${C.bar}"/>
<line x1="0" y1="34" x2="${W}" y2="34" stroke="${C.line}"/>
<text x="16" y="22" fill="${C.dim}" style="font-size:12px">${esc(owner)}@cipherpr:~$ telemetry --source github-rest-v3 --window ${windowDays}d</text>
${counterEls}
<text x="${leftX}" y="${panelTop + 14}" fill="${C.gold}" style="font-size:11px;letter-spacing:.1em">// ACTIVITY · commits in ${windowDays} days</text>
<text x="${rightX}" y="${panelTop + 14}" fill="${C.gold}" style="font-size:11px;letter-spacing:.1em">// LANGUAGES · share of code</text>
<line x1="${leftX}" y1="${panelTop + 22}" x2="${leftX + colW}" y2="${panelTop + 22}" stroke="${C.line}"/>
<line x1="${rightX}" y1="${panelTop + 22}" x2="${rightX + colW}" y2="${panelTop + 22}" stroke="${C.line}"/>
${activityEls}
${langEls}
<line x1="0" y1="${H - 36}" x2="${W}" y2="${H - 36}" stroke="${C.line}"/>
<text x="20" y="${H - 14}" fill="${C.dim}" style="font-size:11px">featured = repos listed in telemetry/projects.json · public repos = whole account · synced ${esc(synced)} · all numbers from the GitHub API</text>
<rect class="blink" x="${W - 30}" y="${H - 25}" width="8" height="13" fill="${C.green}"/>
</svg>
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg);

  // ---------- activity.svg + status.svg (added: daily graphs) ----------
  writeActivity(projects, windowDays, owner);
  writeStatus(synced);
  console.log(`Wrote ${path.relative(root, outPath)} (${svg.length} bytes) from ${projects.length} featured projects; public repos: ${publicRepos}`);
}


// ============ activity.svg : commits per day across featured projects ============
function writeActivity(projects, windowDays, owner) {
  const W = 880, H = 270, days = 30;
  const perDay = {};
  let haveDates = false;
  for (const p of projects) for (const d of (p.recent_commit_dates || [])) { perDay[d] = (perDay[d] || 0) + 1; haveDates = true; }
  const list = [];
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    list.push({ key, n: perDay[key] || 0, label: key.slice(5) });
  }
  const total = list.reduce((a, b) => a + b.n, 0);
  const active = list.filter(d => d.n > 0).length;
  const best = list.reduce((a, b) => (b.n > a.n ? b : a), list[0]);
  const max = Math.max(1, best.n);
  const x0 = 24, chartW = W - 48, slot = chartW / days, bw = slot - 6;
  const base = 212, chartH = 120;
  const bars = list.map((d, i) => {
    const h = d.n ? Math.max(4, Math.round((d.n / max) * chartH)) : 2;
    const x = x0 + i * slot + 3;
    const col = d.n ? C.green : C.line;
    const lab = (i % 5 === 0 || i === days - 1) ? `<text x="${x + bw / 2}" y="${base + 18}" fill="${C.dim}" text-anchor="middle" style="font-size:10px">${d.label}</text>` : '';
    const val = d.n ? `<text x="${x + bw / 2}" y="${base - h - 5}" fill="${C.gold}" text-anchor="middle" style="font-size:10px;font-weight:700">${d.n}</text>` : '';
    return `<rect class="bar" style="animation-delay:${0.2 + i * 0.03}s" x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="2" fill="${col}"/>${val}${lab}`;
  }).join('\n');
  const body = haveDates
    ? bars
    : `<text x="${W / 2}" y="140" fill="${C.dim}" text-anchor="middle">awaiting first daily sync…</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Commit activity over the last ${days} days across featured projects: ${total} commits on ${active} active days${haveDates ? ', busiest day ' + best.key + ' with ' + best.n : ''}.">
<title>Commit activity, last ${days} days — ${esc(owner)}</title>
<style>
  text{font-family:${FONT};font-size:12px}
  .bar{transform-box:fill-box;transform-origin:50% 100%;animation:grow .7s cubic-bezier(.2,.7,.2,1) both}
  @keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
  @media (prefers-reduced-motion:reduce){.bar{animation:none}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="8" fill="${C.bg}" stroke="${C.line}"/>
<path d="M.5 8.5a8 8 0 0 1 8-8h${W - 17}a8 8 0 0 1 8 8V34H.5z" fill="${C.bar}"/>
<line x1="0" y1="34" x2="${W}" y2="34" stroke="${C.line}"/>
<text x="16" y="22" fill="${C.dim}">${esc(owner)}@cipherpr:~$ git log --since=${days}.days</text>
<text x="${W - 16}" y="22" fill="${C.gold}" text-anchor="end">${total} commits · ${active} active days${haveDates ? ' · best ' + best.label + ' (' + best.n + ')' : ''}</text>
<line x1="${x0}" y1="${base}" x2="${W - x0}" y2="${base}" stroke="${C.line}"/>
${body}
</svg>
`;
  fs.writeFileSync(path.join(root, 'assets', 'activity.svg'), svg);
}

// ============ status.svg : README age + telemetry uptime ============
function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

function writeStatus(synced) {
  const { execSync } = require('child_process');
  const today = new Date().toISOString().slice(0, 10);

  // history of successful daily runs (this script only runs after telemetry succeeded)
  const histPath = path.join(root, 'telemetry', 'history.json');
  let hist = { first_run: today, successful_days: [] };
  try { hist = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (_) {}
  if (!Array.isArray(hist.successful_days)) hist.successful_days = [];
  if (!hist.first_run) hist.first_run = today;
  if (!hist.successful_days.includes(today)) hist.successful_days.push(today);
  hist.successful_days = [...new Set(hist.successful_days)].sort();
  fs.writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');

  const have = new Set(hist.successful_days);
  const span = dayDiff(hist.first_run, today) + 1;
  const downtime = Math.max(0, span - have.size);
  let streak = 0;
  for (let d = new Date(today + 'T00:00:00Z'); have.has(d.toISOString().slice(0, 10)); d = new Date(d.getTime() - 86400000)) streak++;

  // days since the profile was last changed by a person (bot telemetry commits ignored)
  let sinceChange = '—';
  try {
    const iso = execSync('git log -1 --format=%cI --invert-grep --grep="chore(telemetry)" -- README.md assets', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (iso) sinceChange = String(Math.max(0, dayDiff(iso.slice(0, 10), today)));
  } catch (_) {}

  const W = 880, H = 84;
  const cells = [
    ['README UNCHANGED', sinceChange === '—' ? '—' : (sinceChange === '0' ? 'today' : `${sinceChange}d`)],
    ['LAST SYNC', today.slice(5)],
    ['SYNC STREAK', `${streak}d`],
    ['DOWNTIME DAYS', String(downtime)],
    ['RUNNING SINCE', hist.first_run.slice(5)],
  ];
  const cw = W / cells.length;
  const els = cells.map(([k, v], i) => `<g>
  ${i ? `<line x1="${i * cw}" y1="14" x2="${i * cw}" y2="${H - 14}" stroke="${C.line}"/>` : ''}
  <text x="${i * cw + cw / 2}" y="34" fill="${C.dim}" text-anchor="middle" style="font-size:10px;letter-spacing:.1em">${k}</text>
  <text x="${i * cw + cw / 2}" y="62" fill="${k === 'DOWNTIME DAYS' && downtime === 0 ? C.green : C.gold}" text-anchor="middle" style="font-size:22px;font-weight:700">${v}</text>
</g>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Profile status: README unchanged for ${sinceChange} days, last telemetry sync ${today}, sync streak ${streak} days, ${downtime} downtime days, running since ${hist.first_run}.">
<title>Profile status</title>
<style>text{font-family:${FONT};font-size:12px}</style>
<path d="M.5 0V${H - 8.5}a8 8 0 0 0 8 8h${W - 17}a8 8 0 0 0 8-8V0" fill="${C.bar}" stroke="${C.line}"/>
${els}
</svg>
`;
  fs.writeFileSync(path.join(root, 'assets', 'status.svg'), svg);
}

main().catch(err => { console.error(err); process.exit(1); });
