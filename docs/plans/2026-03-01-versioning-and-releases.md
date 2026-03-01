# Versioning and Releases Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add semantic versioning with automatic changelog generation, git release tagging, and CI-built multi-platform installers.

**Architecture:** `release-it` with `@release-it/conventional-changelog` handles local release flow (version bump, changelog, tag, draft GitHub Release). A GitHub Actions workflow triggers on tag push to build Electron Forge installers on all three platforms and attach them to the draft release.

**Tech Stack:** release-it, @release-it/conventional-changelog, GitHub Actions, softprops/action-gh-release@v2

---

### Task 1: Install release-it dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run:
```bash
npm install --save-dev release-it @release-it/conventional-changelog
```

**Step 2: Verify installation**

Run:
```bash
npx release-it --version
```
Expected: Prints release-it version number (19.x)

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add release-it dependencies"
```

---

### Task 2: Configure release-it

**Files:**
- Create: `.release-it.json`
- Modify: `package.json` (add scripts)

**Step 1: Create `.release-it.json`**

```json
{
  "$schema": "https://unpkg.com/release-it/schema/release-it.json",
  "git": {
    "commitMessage": "chore(release): v${version}",
    "tagName": "v${version}",
    "tagAnnotation": "Release v${version}",
    "requireCleanWorkingDir": true,
    "requireBranch": "master",
    "push": true
  },
  "github": {
    "release": true,
    "draft": true,
    "releaseName": "v${version}",
    "tokenRef": "GITHUB_TOKEN"
  },
  "npm": {
    "publish": false
  },
  "plugins": {
    "@release-it/conventional-changelog": {
      "preset": {
        "name": "conventionalcommits",
        "types": [
          { "type": "feat", "section": "Features" },
          { "type": "fix", "section": "Bug Fixes" },
          { "type": "perf", "section": "Performance" },
          { "type": "refactor", "section": "Refactoring" },
          { "type": "docs", "section": "Documentation" },
          { "type": "chore", "section": "Miscellaneous" }
        ]
      },
      "infile": "CHANGELOG.md",
      "header": "# Changelog"
    }
  }
}
```

**Step 2: Add scripts to `package.json`**

Add these to the `"scripts"` section:

```json
"release": "release-it",
"release:minor": "release-it minor",
"release:major": "release-it major"
```

**Step 3: Dry-run to verify configuration**

Run:
```bash
npx release-it --dry-run
```
Expected: Shows what would happen (version bump, changelog, tag, GitHub release) without actually doing anything. Verify it detects the correct bump type from recent commits.

**Step 4: Commit**

```bash
git add .release-it.json package.json
git commit -m "chore: configure release-it with conventional changelog"
```

---

### Task 3: Create GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create the workflow file**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            platform: win32
          - os: macos-latest
            platform: darwin
          - os: ubuntu-latest
            platform: linux

    runs-on: ${{ matrix.os }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      # Linux: deb maker needs dpkg+fakeroot, rpm maker needs rpm
      - name: Install Linux build dependencies
        if: matrix.os == 'ubuntu-latest'
        run: sudo apt-get update -y && sudo apt-get install -y dpkg fakeroot rpm

      - name: Install dependencies
        run: npm ci

      - name: Build and make
        run: npm run make
        env:
          CI: true

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: artifacts-${{ matrix.platform }}
          path: out/make/
          if-no-files-found: error

      - name: Attach artifacts to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            out/make/**/*.exe
            out/make/**/*.nupkg
            out/make/**/*.zip
            out/make/**/*.deb
            out/make/**/*.rpm
          fail_on_unmatched_files: false
          append_body: true
          body: |
            ---
            > **Note:** macOS and Linux builds are untested and provided as-is.
```

**Step 2: Validate YAML syntax**

Run:
```bash
npx yaml-lint .github/workflows/release.yml 2>/dev/null || python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" 2>/dev/null || echo "Install a YAML linter to validate, or review manually"
```

**Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add multi-platform release workflow"
```

---

### Task 4: Test the full release flow (dry run)

**Step 1: Set up GitHub token**

Ensure `GITHUB_TOKEN` environment variable is set with a token that has `repo` scope.

**Step 2: Run release-it dry run**

Run:
```bash
npx release-it --dry-run
```

Expected output should show:
- Version bump (e.g., `1.0.0` → `1.1.0` based on feat: commits)
- CHANGELOG.md would be created/updated
- Git tag `v1.1.0` would be created
- Draft GitHub Release would be created

**Step 3: If dry run looks good, run first real release**

Run:
```bash
npm run release
```

This will:
1. Bump `package.json` version
2. Create `CHANGELOG.md`
3. Commit `chore(release): v{version}`
4. Tag `v{version}`
5. Push to origin
6. Create draft GitHub Release

**Step 4: Verify on GitHub**

- Check that the draft release exists at `https://github.com/yarong-lifemap/claude-terminal/releases`
- Check that the tag push triggered the release workflow
- Monitor workflow runs for build success on all three platforms
- Verify artifacts are attached to the draft release

**Step 5: Publish the release**

Once builds complete and artifacts are attached, publish the draft release on GitHub.
