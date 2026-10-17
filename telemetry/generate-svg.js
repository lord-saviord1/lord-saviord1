#!/usr/bin/env node
// Renders assets/telemetry.svg from telemetry/data.json (written by generate-telemetry.js).
// Reads only fields that already exist in data.json. Uses no network and no dependencies.
//
// Usage:  node telemetry/generate-svg.js            (from the repo root)

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

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const projects = Array.isArray(data.projects) ? data.projects.filter(p => p.status === 'ok') : [];
const langs = Array.isArray(data.language_telemetry) ? data.language_telemetry : [];

const scanned = `${data.successful_project_count ?? projects.length}/${data.project_count ?? projects.length}`;
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
  ['PROJECTS SCANNED', scanned],
  [`COMMITS · LAST ${windowDays}D`, String(totalRecent)],
  ['WITH LIVE URL', String(liveCount)],
  ['LAST SYNC', synced],
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

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub telemetry: ${esc(scanned)} projects scanned, ${totalRecent} commits in the last ${windowDays} days, ${liveCount} projects with a live URL, last synced ${esc(synced)}.">
<title>Cipher PR GitHub telemetry</title>
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
<text x="16" y="22" fill="${C.dim}" style="font-size:12px">cipher@telemetry ~ $ github --rest-api-v3 --window ${windowDays}d</text>
${counterEls}
<text x="${leftX}" y="${panelTop + 14}" fill="${C.gold}" style="font-size:11px;letter-spacing:.1em">// ACTIVITY · commits in ${windowDays} days</text>
<text x="${rightX}" y="${panelTop + 14}" fill="${C.gold}" style="font-size:11px;letter-spacing:.1em">// LANGUAGES · share of code</text>
<line x1="${leftX}" y1="${panelTop + 22}" x2="${leftX + colW}" y2="${panelTop + 22}" stroke="${C.line}"/>
<line x1="${rightX}" y1="${panelTop + 22}" x2="${rightX + colW}" y2="${panelTop + 22}" stroke="${C.line}"/>
${activityEls}
${langEls}
<line x1="0" y1="${H - 36}" x2="${W}" y2="${H - 36}" stroke="${C.line}"/>
<text x="20" y="${H - 14}" fill="${C.dim}" style="font-size:11px">source: GitHub REST API v3 · generated ${esc(synced)} · numbers come from data.json, nothing is typed by hand</text>
<rect class="blink" x="${W - 30}" y="${H - 25}" width="8" height="13" fill="${C.green}"/>
</svg>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, svg);
console.log(`Wrote ${path.relative(root, outPath)} (${svg.length} bytes) from ${projects.length} projects`);
