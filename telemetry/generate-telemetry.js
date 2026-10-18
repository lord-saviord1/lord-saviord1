#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const START_MARKER = '<!-- TELEMETRY:START -->';
const END_MARKER = '<!-- TELEMETRY:END -->';

const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'telemetry', 'projects.json');
const dataPath = path.join(repoRoot, 'telemetry', 'data.json');
const generatedReadmePath = path.join(repoRoot, 'telemetry', 'README.generated.md');
const profileReadmePath = path.join(repoRoot, 'README.md');

const token = process.env.GITHUB_TOKEN || '';
const baseApiUrl = 'https://api.github.com';

function toDateString(value) {
  return value ? String(value).slice(0, 10) : '—';
}

function inferHostingProvider(url) {
  if (!url) return '—';
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (
      hostname.endsWith('vercel.app') ||
      hostname.includes('vercel-dns.com') ||
      hostname.includes('vercel')
    ) {
      return 'Vercel';
    }
    if (hostname.endsWith('netlify.app') || hostname.includes('netlify')) {
      return 'Netlify';
    }
    if (
      hostname.endsWith('pages.dev') ||
      hostname.endsWith('workers.dev') ||
      hostname.includes('cloudflare') ||
      hostname.endsWith('cipherpr.live') ||
      hostname.endsWith('cipherpr.tech') ||
      hostname.endsWith('cipherpr.me')
    ) {
      return hostname.endsWith('github.io') ? 'GitHub Pages' : 'Cloudflare';
    }
    if (hostname.endsWith('github.io')) {
      return 'GitHub Pages';
    }
    return 'Custom Domain';
  } catch {
    return 'Custom Domain';
  }
}

function extractHostname(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function formatProvenance(provenance) {
  const map = {
    verified_from_repository: 'verified_from_repository',
    confirmed_by_owner: 'confirmed_by_owner',
    inferred_from_deployment_url: 'inferred_from_deployment_url'
  };
  return map[provenance] || 'unknown';
}

function normalizeLanguages(languageBytes) {
  const total = Object.values(languageBytes).reduce((sum, value) => sum + value, 0);
  if (!total) {
    return { total, percentages: {} };
  }

  const percentages = Object.fromEntries(
    Object.entries(languageBytes)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([language, bytes]) => [language, Number(((bytes / total) * 100).toFixed(2))])
  );

  return { total, percentages };
}

function summarizeCommit(message) {
  if (!message) return '—';
  const firstLine = String(message).split('\n')[0].replace(/\s+/g, ' ').trim();
  if (firstLine.length <= 72) return firstLine;
  return `${firstLine.slice(0, 69)}...`;
}

function formatStackSummary(percentages) {
  const entries = Object.entries(percentages);
  if (!entries.length) return 'Unavailable';
  return entries
    .slice(0, 3)
    .map(([language, pct]) => `${language} ${pct}%`)
    .join(' · ');
}

function escapePipes(value) {
  return String(value).replace(/\|/g, '\\|');
}

async function apiGet(pathname) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'lord-saviord1-profile-telemetry',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  try {
    const response = await fetch(`${baseApiUrl}${pathname}`, { headers });

    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      const remaining = response.headers.get('x-ratelimit-remaining');
      if (response.status === 403 && remaining === '0') {
        return { ok: false, error: 'rate_limited', status: response.status };
      }

      return {
        ok: false,
        error: body?.message || `request_failed_${response.status}`,
        status: response.status
      };
    }

    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: `network_error: ${error.message}` };
  }
}

async function readExistingTelemetry() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function shouldUseCachedProject(project) {
  if (!project || project.status !== 'unavailable') return false;
  const knownTransientErrors = new Set(['request_failed_403', 'rate_limited', 'network_error']);
  if (knownTransientErrors.has(project.error)) return true;
  return String(project.error || '').startsWith('network_error:');
}

function mergeWithCachedProject(current, cached) {
  if (!cached || cached.status !== 'ok') return current;
  const mergedProvider = current.provider && current.provider !== '—' ? current.provider : cached.provider || '—';
  const mergedProviderProvenance =
    current.provider_provenance && current.provider_provenance !== 'unknown'
      ? current.provider_provenance
      : cached.provider_provenance || 'unknown';
  return {
    ...cached,
    deployment_url: current.deployment_url || cached.deployment_url || null,
    deployment_hostname: current.deployment_hostname || cached.deployment_hostname || null,
    provider: mergedProvider,
    provider_provenance: mergedProviderProvenance,
    cache_fallback: true,
    cache_fallback_reason: current.error
  };
}

async function collectProjectTelemetry(project, sinceIso, windowDays) {
  const repo = String(project.repo || '').trim();
  const [owner, repoName] = repo.split('/');
  const deploymentUrl = project.deployment_url || null;

  if (!owner || !repoName) {
    return {
      repo,
      status: 'unavailable',
      error: 'invalid_repository_name',
      deployment_url: deploymentUrl,
      deployment_hostname: extractHostname(deploymentUrl),
      provider: inferHostingProvider(deploymentUrl),
      provider_provenance: deploymentUrl ? 'inferred_from_deployment_url' : 'unknown',
      last_updated: null,
      data_source: 'GitHub REST API v3'
    };
  }

  const repoResponse = await apiGet(`/repos/${owner}/${repoName}`);
  if (!repoResponse.ok) {
    return {
      repo,
      status: 'unavailable',
      error: repoResponse.error,
      deployment_url: deploymentUrl,
      deployment_hostname: extractHostname(deploymentUrl),
      provider: inferHostingProvider(deploymentUrl),
      provider_provenance: deploymentUrl ? 'inferred_from_deployment_url' : 'unknown',
      last_updated: null,
      data_source: 'GitHub REST API v3'
    };
  }

  const repository = repoResponse.data;
  const defaultBranch = repository.default_branch;

  const [languagesResponse, latestCommitResponse, recentCommitsResponse] = await Promise.all([
    apiGet(`/repos/${owner}/${repoName}/languages`),
    apiGet(`/repos/${owner}/${repoName}/commits?per_page=1&sha=${encodeURIComponent(defaultBranch)}`),
    apiGet(
      `/repos/${owner}/${repoName}/commits?per_page=100&sha=${encodeURIComponent(
        defaultBranch
      )}&since=${encodeURIComponent(sinceIso)}`
    )
  ]);

  const languageBytes = languagesResponse.ok && languagesResponse.data ? languagesResponse.data : {};
  const { percentages } = normalizeLanguages(languageBytes);

  let latestCommit = null;
  if (latestCommitResponse.ok && Array.isArray(latestCommitResponse.data) && latestCommitResponse.data.length) {
    const item = latestCommitResponse.data[0];
    latestCommit = {
      sha: item.sha,
      date: item.commit?.author?.date || null,
      author: item.commit?.author?.name || item.author?.login || 'unknown',
      message: summarizeCommit(item.commit?.message || ''),
      url: item.html_url || null
    };
  }

  const recentCommitCount =
    recentCommitsResponse.ok && Array.isArray(recentCommitsResponse.data)
      ? recentCommitsResponse.data.length
      : null;

  const bounded = recentCommitCount === 100;

  const resolvedDeployment = deploymentUrl || repository.homepage || null;
  const resolvedProvider = inferHostingProvider(resolvedDeployment);

  return {
    repo,
    status: 'ok',
    repo_url: repository.html_url,
    default_branch: defaultBranch,
    description: repository.description || null,
    primary_language: repository.language || null,
    languages: {
      bytes: languageBytes,
      percentages
    },
    pushed_at: repository.pushed_at || null,
    updated_at: repository.updated_at || null,
    latest_activity_at: repository.pushed_at || repository.updated_at || null,
    latest_commit: latestCommit,
    recent_commit_count: recentCommitCount,
    recent_commit_window_days: windowDays,
    recent_commit_count_bounded: bounded,
    homepage: repository.homepage || null,
    deployment_url: resolvedDeployment,
    deployment_hostname: extractHostname(resolvedDeployment),
    provider: resolvedProvider,
    provider_provenance: resolvedDeployment ? 'inferred_from_deployment_url' : 'unknown',
    last_updated: new Date().toISOString(),
    data_source: 'GitHub REST API v3'
  };
}

function buildLanguageTelemetry(projects) {
  const aggregate = new Map();
  for (const project of projects) {
    if (project.status !== 'ok' || !project.languages?.bytes) continue;
    for (const [language, bytes] of Object.entries(project.languages.bytes)) {
      aggregate.set(language, (aggregate.get(language) || 0) + bytes);
    }
  }

  const totalBytes = Array.from(aggregate.values()).reduce((sum, value) => sum + value, 0);
  const sorted = Array.from(aggregate.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return sorted.map(([language, bytes]) => ({
    language,
    bytes,
    percentage: totalBytes ? Number(((bytes / totalBytes) * 100).toFixed(2)) : 0
  }));
}

function buildServiceZonesTelemetry(configServiceZones, projects) {
  const connectedRepos = Array.from(
    new Set(projects.filter((project) => project.repo).map((project) => project.repo))
  ).sort((a, b) => a.localeCompare(b));

  return (configServiceZones || []).map((zone) => ({
    zone: zone.zone,
    services: (zone.services || []).map((service) => ({
      name: service.name,
      role: service.role,
      provenance: formatProvenance(service.provenance),
      evidence: service.evidence
    })),
    connected_repo_count: connectedRepos.length,
    connected_repositories: connectedRepos
  }));
}

function buildServiceProviderTelemetry(projects) {
  const providerMap = new Map();

  for (const project of projects) {
    const provider = project.provider || '—';
    const key = provider.toLowerCase();

    if (!providerMap.has(key)) {
      providerMap.set(key, {
        provider,
        role: provider === '—' ? 'No deployment provider detected' : 'Deployment and live delivery',
        provenance: formatProvenance(project.provider_provenance),
        evidence_source:
          project.provider_provenance === 'inferred_from_deployment_url'
            ? 'deployment_url'
            : project.provider_provenance,
        repositories: [],
        domains: [],
        live_urls: []
      });
    }

    const item = providerMap.get(key);
    item.repositories.push(project.repo);

    if (project.deployment_hostname) {
      item.domains.push(project.deployment_hostname);
    }

    if (project.deployment_url) {
      item.live_urls.push(project.deployment_url);
    }
  }

  return Array.from(providerMap.values())
    .map((item) => ({
      ...item,
      repositories: Array.from(new Set(item.repositories)).sort((a, b) => a.localeCompare(b)),
      domains: Array.from(new Set(item.domains)).sort((a, b) => a.localeCompare(b)),
      live_urls: Array.from(new Set(item.live_urls)).sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function buildGeneratedDashboardMarkdown(data) {
  const lines = [];

  lines.push('### `AUTO-GENERATED TELEMETRY GUI`');
  lines.push('');
  lines.push('<h2 align=\"center\"><code>// TELEMETRY COMMAND CENTER</code></h2>');
  lines.push('');
  lines.push('<table width="100%">');
  lines.push('<tr>');
  lines.push(`<td><b>Status</b><br/>${data.failed_project_count ? '⚠️ partial' : '✅ healthy'}</td>`);
  lines.push(`<td><b>Last updated (UTC)</b><br/><code>${data.last_updated}</code></td>`);
  lines.push(`<td><b>Data source</b><br/>${data.data_source}</td>`);
  lines.push(`<td><b>Projects scanned</b><br/><code>${data.successful_project_count}/${data.project_count}</code></td>`);
  lines.push(
    `<td><b>Commit window</b><br/><code>${data.recent_commit_window_days} days</code> · per repo cap <code>100 commits</code></td>`
  );
  lines.push('</tr>');
  lines.push('</table>');
  lines.push('');
  lines.push('<h2 align=\"center\"><code>// SERVICES & PLATFORM CONTROL</code></h2>');
  lines.push('');
  lines.push('<table width="100%">');
  lines.push('<tr><th align="left">Zone</th><th align="left">Service panel</th><th align="left">Role matrix</th><th align="left">Provenance</th><th align="left">Connected repositories</th></tr>');

  for (const zone of data.service_zones) {
    const servicePanel = zone.services.map((service) => `<code>${service.name}</code>`).join(' · ');
    const rolePanel = zone.services.map((service) => `${service.name}: ${service.role}`).join('<br/>');
    const provenancePanel = zone.services
      .map((service) => `${service.name}: <code>${service.provenance}</code>`)
      .join('<br/>');

    lines.push(
      `<tr><td><b>${zone.zone}</b></td><td>${servicePanel}</td><td>${rolePanel}</td><td>${provenancePanel}</td><td>${zone.connected_repo_count} repos</td></tr>`
    );
  }
  lines.push('</table>');
  lines.push('');

  lines.push('<h2 align=\"center\"><code>// SERVICE PROVIDER TELEMETRY</code></h2>');
  lines.push('');
  lines.push('<table width="100%">');
  lines.push('<tr><th align="left">Provider</th><th align="left">Role</th><th align="left">Evidence / source</th><th align="left">Connected repositories / domains</th><th align="left">Live URLs</th></tr>');

  for (const provider of data.service_provider_telemetry) {
    const repos = provider.repositories.length
      ? provider.repositories.map((repo) => `<code>${repo}</code>`).join('<br/>')
      : '—';
    const domains = provider.domains.length
      ? provider.domains.map((domain) => `<code>${domain}</code>`).join('<br/>')
      : '—';
    const links = provider.live_urls.length
      ? provider.live_urls.map((url) => `<a href="${url}">${url}</a>`).join('<br/>')
      : '—';
    const evidence = `${provider.evidence_source}<br/><code>${provider.provenance}</code>`;

    lines.push(
      `<tr><td><b>${provider.provider}</b></td><td>${provider.role}</td><td>${evidence}</td><td>${repos}<br/>${domains}</td><td>${links}</td></tr>`
    );
  }
  lines.push('</table>');
  lines.push('');

  lines.push('<h2 align=\"center\"><code>// SOURCE CONTROL & PROJECT ACTIVITY</code></h2>');
  lines.push('');
  lines.push('| Project | Stack / languages | Last update | Latest commit | Deployment | Provider |');
  lines.push('|---|---|---|---|---|---|');

  for (const project of data.projects) {
    const projectLink = project.repo_url
      ? `[${project.repo}](${project.repo_url})`
      : escapePipes(project.repo || 'unknown');

    const stack = project.status === 'ok'
      ? escapePipes(formatStackSummary(project.languages?.percentages || {}))
      : `Unavailable (${escapePipes(project.error || 'unknown_error')})`;

    const lastUpdate = toDateString(project.latest_activity_at);

    let latestCommitSummary = '—';
    if (project.latest_commit?.sha) {
      const shortSha = project.latest_commit.sha.slice(0, 7);
      const commitDate = toDateString(project.latest_commit.date);
      const commitMessage = escapePipes(project.latest_commit.message || '');
      const commitAuthor = escapePipes(project.latest_commit.author || 'unknown');
      latestCommitSummary = project.latest_commit.url
        ? `[${shortSha}](${project.latest_commit.url}) · ${commitDate} · ${commitAuthor} · ${commitMessage}`
        : `${shortSha} · ${commitDate} · ${commitAuthor} · ${commitMessage}`;
    }

    const deployment = project.deployment_url
      ? `[${project.deployment_url}](${project.deployment_url})`
      : '—';

    lines.push(
      `| ${projectLink} | ${stack} | ${lastUpdate} | ${latestCommitSummary} | ${deployment} | ${project.provider || '—'} |`
    );
  }

  lines.push('');
  lines.push('<h2 align=\"center\"><code>// LANGUAGE TELEMETRY MATRIX</code></h2>');
  lines.push('');
  lines.push('| Language | Bytes | Percentage |');
  lines.push('|---|---:|---:|');

  if (data.language_telemetry.length) {
    for (const language of data.language_telemetry) {
      lines.push(`| ${language.language} | ${language.bytes.toLocaleString('en-US')} | ${language.percentage}% |`);
    }
  } else {
    lines.push('| Unavailable | 0 | 0% |');
  }

  lines.push('');
  lines.push('<h2 align=\"center\"><code>// TELEMETRY NOTES</code></h2>');
  lines.push('');
  if (data.profile_activity_reference?.url) {
    lines.push(
     `> Optional profile activity reference (${data.profile_activity_reference.window_start} to ${data.profile_activity_reference.window_end}): [${data.profile_activity_reference.url}](${data.profile_activity_reference.url})`
    );
    lines.push('');
  }
  lines.push(
    '> Provenance labels: `verified_from_repository`, `confirmed_by_owner`, `inferred_from_deployment_url`.'
  );
  lines.push('');
  lines.push(
    `> JSON artifact: [telemetry/data.json](./telemetry/data.json) · workflow: [.github/workflows/update-telemetry.yml](./.github/workflows/update-telemetry.yml)`
  );
  lines.push('');
  lines.push(
    '> Generated from GitHub repository metadata and commit history; local-only terminal activity is not collected.'
  );

  return lines.join('\n');
}

function upsertTelemetryBlock(readmeContent, blockContent) {
  const fullBlock = `${START_MARKER}\n${blockContent}\n${END_MARKER}`;

  if (readmeContent.includes(START_MARKER) && readmeContent.includes(END_MARKER)) {
    return readmeContent.replace(
      new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`, 'm'),
      fullBlock
    );
  }

  const heading = '## `// GITHUB TELEMETRY`';
  if (readmeContent.includes(heading)) {
    return readmeContent.replace(heading, `${heading}\n\n${fullBlock}`);
  }

  return `${readmeContent.trimEnd()}\n\n## \`// GITHUB TELEMETRY\`\n\n${fullBlock}\n`;
}

async function main() {
  const configRaw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configRaw);
  const existingTelemetry = await readExistingTelemetry();
  const cachedProjectsByRepo = new Map(
    (existingTelemetry?.projects || [])
      .filter((project) => project && project.repo)
      .map((project) => [String(project.repo).toLowerCase(), project])
  );

  const excluded = new Set((config.excluded_repositories || []).map((repo) => repo.toLowerCase()));
  const seen = new Set();

  const filteredProjects = (config.projects || [])
    .filter((project) => project && project.repo)
    .filter((project) => !excluded.has(String(project.repo).toLowerCase()))
    .filter((project) => {
      const key = String(project.repo).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const windowDays = Number(config.recent_commit_window_days) || 30;
  const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const projectTelemetry = [];
  for (const project of filteredProjects) {
    // Intentional sequential collection to preserve deterministic API ordering in logs and output.
    const current = await collectProjectTelemetry(project, sinceIso, windowDays);
    if (shouldUseCachedProject(current)) {
      const cached = cachedProjectsByRepo.get(String(current.repo).toLowerCase());
      projectTelemetry.push(mergeWithCachedProject(current, cached));
      continue;
    }
    projectTelemetry.push(current);
  }

  const languageTelemetry = buildLanguageTelemetry(projectTelemetry);
  const serviceZonesTelemetry = buildServiceZonesTelemetry(config.service_zones, projectTelemetry);
  const serviceProviderTelemetry = buildServiceProviderTelemetry(projectTelemetry);
  const successfulCount = projectTelemetry.filter((project) => project.status === 'ok').length;
  const failedCount = projectTelemetry.length - successfulCount;

  const data = {
    data_source: config.data_source || 'GitHub REST API v3',
    generated_by: 'telemetry/generate-telemetry.js',
    source_profile_repository: process.env.GITHUB_REPOSITORY || 'lord-saviord1/lord-saviord1',
    last_updated: new Date().toISOString(),
    recent_commit_window_days: windowDays,
    project_count: projectTelemetry.length,
    successful_project_count: successfulCount,
    failed_project_count: failedCount,
    profile_activity_reference: config.profile_activity_reference || null,
    projects: projectTelemetry,
    language_telemetry: languageTelemetry,
    service_zones: serviceZonesTelemetry,
    service_provider_telemetry: serviceProviderTelemetry
  };

  const generatedBody = buildGeneratedDashboardMarkdown(data);
  const generatedFile = [
    '<!-- AUTO-GENERATED FILE: DO NOT EDIT MANUALLY -->',
    '<!-- Source: telemetry/generate-telemetry.js -->',
    '',
    generatedBody,
    ''
  ].join('\n');

  await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.writeFile(generatedReadmePath, generatedFile, 'utf8');

  const profileReadme = await fs.readFile(profileReadmePath, 'utf8');
  const updatedProfileReadme = upsertTelemetryBlock(profileReadme, generatedBody);
  await fs.writeFile(profileReadmePath, updatedProfileReadme, 'utf8');
}

main().catch((error) => {
  console.error('Telemetry generation failed:', error);
  process.exitCode = 1;
});
