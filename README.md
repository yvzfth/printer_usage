# Printer Report App

Printer Report App lets you upload HP Web Jetadmin HTML exports, analyze per-user/per-printer usage, and bundle everything into a cross‑platform desktop experience with Electron.

## Tech Stack

- Next.js 14 + App Router, React 19, TypeScript, Tailwind CSS
- Node API routes for saving/loading reports as JSON
- Electron 30 for macOS/Windows desktop shells (via `electron-builder`)

## Prerequisites

- Node.js 22+ (pnpm bundles 22.x, but install a compatible local version)
- pnpm 8+
- macOS users building Windows binaries additionally need Wine/Mono; Windows users need proper signing tools if they plan to sign installers.

## Local Development

```bash
pnpm install
pnpm dev              # Next.js only
pnpm electron:dev     # Next.js dev server + Electron shell (uses port 3100)
```

## Production Builds

```bash
pnpm build                    # Next.js standalone build
pnpm electron:build:mac       # macOS .app/.dmg (unsigned, local testing)
pnpm electron:build:win       # Windows NSIS installer
```

Each desktop build runs the bundled Next server and stores reports under the user’s `appData`/`Application Support` directory (`reports` subfolder). The web build keeps saving JSON files in `storage/reports`.

## Saving & Viewing Reports

- Upload an HTML report, slice/filter data, and click **Save** to persist it.
- Saved data is grouped by `userName` and stored as JSON. API endpoints live under `/api/reports`.
- The **Saved Reports** page lets users view, rename, or delete reports through the same API routes (works on both web and desktop builds).

## Custom Icons & Branding

- Place your app icon at `public/app-icon.ico`; Electron windows and installers use this asset automatically.
- Update metadata in `package.json` (`name`, `author`, `build.appId`, etc.) to match your organization.

## Troubleshooting

- **Port already in use**: Edit `PORT` in `package.json` scripts if 3100 conflicts with another service.
- **Electron install blocked**: Run `pnpm approve-builds electron` or execute `node node_modules/.pnpm/electron@*/node_modules/electron/install.js`.
- **macOS signing prompts**: mac builds are unsigned; set `CSC_IDENTITY_AUTO_DISCOVERY=false` (already baked into scripts) to suppress signing prompts for local testing.
