# Install: new profile README (terminal SVG edition)

Put these files into your profile repo `lord-saviord1/lord-saviord1`, same paths:

    README.md                              (replaces the old one, keep a backup)
    assets/header.svg                      (new)
    assets/network.svg                     (new)
    assets/telemetry.svg                   (new, the workflow regenerates it)
    telemetry/generate-svg.js              (new)
    .github/workflows/update-telemetry.yml (replaces the old one: adds 1 step)

Do NOT touch: telemetry/generate-telemetry.js, telemetry/projects.json, telemetry/data.json.

Then: GitHub > Actions > "Update repository telemetry" > Run workflow once.
That fills the collapsed telemetry tables and refreshes telemetry.svg.

Test locally (from the repo root): node telemetry/generate-svg.js
