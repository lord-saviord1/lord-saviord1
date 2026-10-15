# Telemetry generator

This folder contains the automated repository telemetry generator used by the profile README.

## Run locally

From repository root:

```bash
node telemetry/generate-telemetry.js
```

## Environment variables

- `GITHUB_TOKEN` (optional but recommended): increases API quota and is used by GitHub Actions.
- `GITHUB_REPOSITORY` (optional): automatically provided in Actions, defaults to `lord-saviord1/lord-saviord1` locally.

The generator also supports unauthenticated local execution. If rate limits are reached, unavailable repositories are recorded and generation continues.

## Add or edit projects

Update `telemetry/projects.json` and re-run the generator:

- add a repository under `projects[].repo` (`owner/name` format)
- optionally set `deployment_url`
- keep excluded repositories in `excluded_repositories`

## Output files

- `telemetry/data.json`: machine-readable telemetry artifact
- `telemetry/README.generated.md`: generated dashboard fragment
- `README.md`: only the content between `<!-- TELEMETRY:START -->` and `<!-- TELEMETRY:END -->` is updated on future runs

## Data limitations

Telemetry is based on GitHub REST API repository metadata and commit history. It cannot infer private local terminal-only activity, unpublished work, or non-GitHub deployment internals.
