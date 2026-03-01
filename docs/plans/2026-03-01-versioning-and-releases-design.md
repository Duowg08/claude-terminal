# Versioning and Release Tagging Design

**Date**: 2026-03-01

## Goal

Add semantic versioning, automatic changelog generation, git release tagging, and CI-built installer artifacts to claude-terminal.

## Version Scheme

- **Semver** (`MAJOR.MINOR.PATCH`)
- `feat:` commits → MINOR bump
- `fix:`, `perf:`, etc. → PATCH bump
- `MAJOR` bump: manual (`--increment major`)
- **Git tags**: `v1.0.0` format
- **Starting version**: `1.0.0` (current)

## Tooling: `release-it`

All-in-one release tool with `@release-it/conventional-changelog` plugin.

### Local Release Flow

```bash
npm run release          # auto-detect bump from commits
npm run release:minor    # force minor bump
npm run release:major    # force major bump
```

Steps performed:
1. Analyze commits since last tag → determine bump type
2. Bump `package.json` version
3. Generate/update `CHANGELOG.md`
4. Commit: `chore(release): v{version}`
5. Create git tag `v{version}`
6. Push commit + tag to origin
7. Create **draft** GitHub Release with changelog as body

User reviews the draft on GitHub, then publishes it.

## GitHub Actions CI

**File**: `.github/workflows/release.yml`
**Trigger**: Tag push matching `v*`

### Jobs

| Job | Runner | Output |
|-----|--------|--------|
| build-windows | windows-latest | `ClaudeTerminalSetup.exe` |
| build-macos | macos-latest | `.zip` (experimental) |
| build-linux | ubuntu-latest | `.deb`, `.rpm` (experimental) |
| upload-assets | ubuntu-latest | Attaches all artifacts to GitHub Release |

Each build job:
1. Checkout code
2. Setup Node.js
3. Install dependencies
4. Run `npm run make`
5. Upload artifacts

Final job downloads all artifacts and attaches them to the GitHub Release matching the tag.

**Note**: macOS and Linux builds are untested. Release notes will include: "macOS and Linux builds are untested and provided as-is."

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add devDeps (`release-it`, `@release-it/conventional-changelog`), add `release` scripts |
| `.release-it.json` | Create | release-it configuration |
| `.github/workflows/release.yml` | Create | CI workflow for multi-platform builds on tag push |
| `CHANGELOG.md` | Auto-generated | Created on first release run |

## release-it Configuration

- Git tag format: `v${version}`
- GitHub release: draft mode, changelog body
- No npm publish (private package)
- Conventional changelog preset for commit parsing
