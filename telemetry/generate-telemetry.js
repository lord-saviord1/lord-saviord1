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
    const isDomain = (domain) => hostname === domain || hostname.endsWith(`.${domain}`);
    if (isDomain('vercel.app') || isDomain('vercel-dns.com')) {
      return 'Vercel';
    }
    if (isDomain('netlify.app')) {
      return 'Netlify';
    }
    if (isDomain('github.io')) {
      return 'GitHub Pages';
    }
    if (isDomain('pages.dev') || isDomain('workers.dev')) {
      return 'Cloudflare';
    }
    return 'Custom Domain';
  } catch {
    return 'Custom Domain';
  }
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
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '&#124;')
    .replace(/\r?\n/g, ' ');
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
      provider: inferHostingProvider(deploymentUrl),
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
      provider: inferHostingProvider(deploymentUrl),
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
    provider: inferHostingProvider(resolvedDeployment),
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

function buildGeneratedDashboardMarkdown(data) {
  const lines = [];

  lines.push('### `AUTO-GENERATED REPOSITORY DASHBOARD`');
  lines.push('');
  lines.push('| Overview | Value |');
  lines.push('|---|---|');
  lines.push(`| Status | ${data.failed_project_count ? '⚠️ partial (some repositories unavailable)' : '✅ healthy'} |`);
  lines.push(`| Last updated (UTC) | \`${data.last_updated}\` |`);
  lines.push(`| Data source | ${data.data_source} |`);
  lines.push(`| Projects scanned | \`${data.successful_project_count}/${data.project_count}\` |`);
  lines.push(
    `| Commit window | \`${data.recent_commit_window_days} days\` (bounded per repo: \`100 commits\`) |`
  );
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
    projectTelemetry.push(await collectProjectTelemetry(project, sinceIso, windowDays));
  }

  const languageTelemetry = buildLanguageTelemetry(projectTelemetry);
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
    projects: projectTelemetry,
    language_telemetry: languageTelemetry
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
