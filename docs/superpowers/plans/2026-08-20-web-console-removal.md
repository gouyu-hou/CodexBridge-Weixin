# Web Console Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused Next.js Web chat console and every active CI, dependency, release, test, and documentation contract that keeps it in the product.

**Architecture:** Treat removal as a release-contract change. Reverse the existing Web release test first, then delete the isolated `apps/web` product tree and clean only active references while preserving historical release and design records.

**Tech Stack:** Node.js 24, TypeScript, node:test, npm, GitHub Actions, Dependabot.

## Global Constraints

- Keep the Weixin Electron administration console and its generated assets unchanged.
- Do not delete or migrate user state, provider profiles, sessions, or CCSwitch configuration.
- Keep historical release notes and completed design/plan documents unchanged.
- Do not stop or restart the running administration service on port `43183`.
- Do not bump the package version or create a GitHub Release.

---

### Task 1: Reverse The Active Release Contract

**Files:**
- Modify: `test/scripts/release_verification.test.ts`

**Interfaces:**
- Consumes: root `package.json`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `docs/RELEASE_PROCESS.md`, and the filesystem.
- Produces: a regression contract that rejects active Web console files, scripts, CI installation, dependency tracking, and release instructions.

- [ ] **Step 1: Write the failing removal contract**

Remove `web:verify` from `requiredScripts`. Replace the current test named
`CI builds the Web console and its README matches the implemented surface`
with assertions equivalent to:

```ts
test('the retired Web console stays outside the active product and release surface', () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  const dependabot = fs.readFileSync(
    path.join(process.cwd(), '.github', 'dependabot.yml'),
    'utf8',
  );
  const releaseDocs = fs.readFileSync(
    path.join(process.cwd(), 'docs', 'RELEASE_PROCESS.md'),
    'utf8',
  );

  assert.equal(fs.existsSync(path.join(process.cwd(), 'apps', 'web')), false);
  assert.deepEqual(
    Object.keys(rootPackage.scripts ?? {}).filter((name) => name.startsWith('web:')),
    [],
  );
  assert.doesNotMatch(rootPackage.scripts?.['verify:release'] ?? '', /web:verify/u);
  assert.doesNotMatch(workflow, /apps\/web|Web console/iu);
  assert.doesNotMatch(dependabot, /\/apps\/web|deps\(web\)/u);
  assert.doesNotMatch(releaseDocs, /apps\/web|Web 控制台|web:verify/iu);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- test/scripts/release_verification.test.ts
```

Expected: FAIL because `apps/web` still exists and active scripts and workflow
references are still present.

- [ ] **Step 3: Commit the failing contract with the implementation only after GREEN**

Keep the failing test uncommitted until Task 2 removes the old product surface.

### Task 2: Remove The Web Product And Restore GREEN

**Files:**
- Delete: `apps/web/**`
- Delete: `test/apps/web_reply_run_manager.test.ts`
- Delete: `test/apps/web_runtime_workspace.test.ts`
- Delete: `test/apps/web_tsx_json_worker.test.ts`
- Delete: `docs/todo/web-ui-happy-alignment-spec.md`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/dependabot.yml`
- Modify: `docs/RELEASE_PROCESS.md`
- Modify: `test/scripts/release_verification.test.ts`

**Interfaces:**
- Consumes: the removal contract from Task 1.
- Produces: a root-only release gate with no Web package installation or build requirements.

- [ ] **Step 1: Remove active root and automation references**

Delete every root script whose key starts with `web:`. Remove only
`npm run web:verify` from the `verify:release` command. Remove the pnpm setup and
Web dependency installation steps from CI. Remove the `/apps/web` Dependabot
entry while preserving root npm and GitHub Actions update entries.

- [ ] **Step 2: Update current release instructions**

Change the CI description to say it runs `npm ci` and the complete
`verify:release` gate. Change release verification documentation to describe
the root project and four packaged workspaces only. Remove the Web pnpm install,
typecheck, and Next.js build instructions.

- [ ] **Step 3: Delete isolated Web code and tests**

Delete the tracked `apps/web` directory, its three root integration tests, and
the obsolete Web UI todo. Do not edit historical documents under
`docs/releases`, `docs/superpowers/specs`, or `docs/superpowers/plans`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- test/scripts/release_verification.test.ts
```

Expected: PASS with no Web package present and no active Web release references.

- [ ] **Step 5: Scan active surfaces for leftovers**

Run:

```powershell
git grep -n -E "apps/web|web:verify|Web console|Web 控制台" -- .github package.json docs/RELEASE_PROCESS.md test
```

Expected: no output. Historical design and release files are intentionally not
part of this scan.

- [ ] **Step 6: Commit the removal**

```powershell
git add -A
git commit -m "refactor: remove Web chat console"
```

### Task 3: Verify The Reduced Release Surface

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: the reduced root release gate.
- Produces: evidence that all retained runtime and package surfaces remain valid.

- [ ] **Step 1: Run release verification**

Run:

```powershell
npm run verify:release
```

Expected: exit code `0`; no pnpm or Next.js Web build command is invoked.

- [ ] **Step 2: Confirm repository state**

Run:

```powershell
git status --short
git diff --check HEAD^..HEAD
```

Expected: clean worktree and no whitespace errors.

- [ ] **Step 3: Review, merge, push, and verify remote SHA**

Request an independent code review. Resolve Critical or Important findings,
fast-forward merge into `main`, rerun `npm run verify:release`, push `main` to
`gouyu`, and compare `git rev-parse main` with `git ls-remote gouyu refs/heads/main`.
