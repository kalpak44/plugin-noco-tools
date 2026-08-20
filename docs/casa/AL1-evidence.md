# CASA AL1 — evidence guide

How this repository produces the evidence for an App Defense Alliance **CASA
Assurance Level 1** assessment, what that evidence does and does not cover, and
what a human still has to do by hand.

Read this before a submission. The pipeline automates scanning; it does not
automate the assessment.

---

## Why this applies

`src/server/services/config.ts` requests
`https://www.googleapis.com/auth/gmail.readonly`. That is a **restricted**
Google OAuth scope, and any app using a restricted scope that can move Google
user data to a third-party server needs a security assessment from a
Google-empanelled assessor, revalidated **every 12 months** from the Letter of
Assessment approval date.

There is no narrower Gmail scope that returns message bodies, so
`googleGmailGetEmail` cannot avoid this. Dropping that one tool — and the
`gmail.readonly` scope with it — is the only way out of the obligation.

## Assurance levels, current as of this writing

ADA replaced the old Tier 1/2/3 naming with two assurance levels:

| Level | What it is |
| --- | --- |
| **AL1** | Lab-validated. You scan your own application and an ADA authorized lab verifies the results. Replaces the old Tier 2. |
| **AL2** | Comprehensive lab assessment covering the application, its deployment infrastructure, and any user-data storage location. Replaces the old Tier 3. |

Two things about this are easy to get wrong:

1. **AL1 is not a reduced control set.** ADA's wording is that *all requirements
   must be satisfied for every level; the only difference between each level is
   the assessment method that applies.* AL1 is a lighter **verification** path,
   not a lighter **bar**.
2. **The self-scan path is deprecated.** The old self-service submission flow is
   gone. Follow the instructions in the CASA notification email; expect to work
   with an authorized lab. This pipeline exists to make you ready for that
   review and to remediate before it, not to replace it.

## What the lab asks for, and where it comes from

| Required artifact | Produced by |
| --- | --- |
| AST configuration file(s) — an export of the scanning policy, or other evidence of what you scanned against | [`.github/codeql/codeql-config.yml`](../../.github/codeql/codeql-config.yml) — declares rule set and scanned/excluded paths, with reasons |
| AST scan results in plain text (`.txt`) | `evidence/security-risk-report.txt`, from [`scripts/casa-report.mjs`](../../scripts/casa-report.mjs) |
| CASA notification email | You — from ADA/Google. Not in this repo |
| Industry certifications, if any | You. Not in this repo |

Every run of [`.github/workflows/security.yml`](../../.github/workflows/security.yml)
uploads a `casa-al1-evidence` artifact containing the report, the raw scanner
output, the SBOM, and the scan config. Retention is 90 days.

### Getting the bundle

```
gh run list --workflow=security.yml --limit 5
gh run download <run-id> --name casa-al1-evidence
```

### Reproducing it locally

```
npm ci
mkdir -p evidence/codeql
npm audit --omit=dev --json > evidence/npm-audit.json     || true   # gated tree
npm audit --json            > evidence/npm-audit-dev.json || true   # toolchain
npm run sbom -- --output-file evidence/sbom.json
npm run security:report
```

SAST is reported as `NOT RUN` locally unless you place CodeQL SARIF in
`evidence/codeql/` — the CodeQL CLI is not a project dependency. The script
never reports a missing scanner as a clean result.

## The pass gate

ADA's bar is *no findings linked to CWEs with a high likelihood of exploit*,
and on revalidation, none at medium either.

"Likelihood of exploit" is not a field any scanner emits, so the report
approximates it with CVSS: CodeQL rule `security-severity` scores banded per
CVSS v3.1, and npm audit's `moderate` mapped to `medium`. The approximation is
deliberately conservative — it never downgrades a finding. The build fails at
`high` and above by default; `workflow_dispatch` accepts a different threshold,
and **you should run at `medium` before a revalidation** to see what the
stricter bar would catch:

```
gh workflow run security.yml -f threshold=medium
```

## Scoping decisions

An assessor will ask about each of these. The answers are in the report itself
(section 5) so the artifact stands alone, and are repeated here with more room.

### Production dependencies: none, and the empty scan is the real result

The plugin declares **zero** production dependencies. Every `@nocobase/*`
package and `zod` is a `peerDependency` resolved from the host NocoBase
installation; the published tarball ships compiled first-party code only. So
the gated SCA row legitimately reports an empty tree.

This is a genuine security property, not a gap — but an empty scan looks
identical to a scan that never ran, which is why the report labels scanner
status explicitly and distinguishes `completed` from `NOT RUN`.

### Build toolchain: reported in full, not gated

`devDependencies` exist so CI can typecheck the plugin against the NocoBase API
surface it compiles against. That pulls in the `@nocobase/client` frontend chain
and, with it, a few dozen advisories (`mermaid`, `pdfjs-dist`, `dompurify`,
`@ant-design/pro-layout`, `decompress`, `lodash`, …).

They are reported in full rather than suppressed, and **not** gated on:

- none of that code is present in the published package;
- none of it executes at plugin runtime;
- most have no upstream fix at the pinned NocoBase version.

Gating on them would make the build permanently red for reasons this repository
cannot fix, which reliably teaches everyone to ignore the gate. The risk
acceptance is recorded in [`.github/dependabot.yml`](../../.github/dependabot.yml)
and must be reassessed at each NocoBase version bump.

### Host runtime: tracked, not owned

The dependency tree the plugin actually executes inside belongs to the host
NocoBase installation. The scheduled `runtime-audit` job installs the pinned
peer set and audits it weekly, purely so a patched NocoBase release gets
noticed. It is informational by design and never fails the build. See also
SECURITY.md, "Out of scope".

### DAST: out of scope here, and why

The plugin has no independently deployable HTTP surface. Its REST endpoints are
mounted inside the host NocoBase application and inherit that application's
authentication, session handling, TLS termination, and network exposure.
Dynamic testing is only meaningful against a deployed host instance, so it
cannot live in a repository-level pipeline.

**This is a real gap, not a dismissal.** If your CASA notification requires
DAST, it has to run against a deployed NocoBase instance with the plugin
enabled, and that instance's owner has to arrange it.

### Secret scanning

Handled by GitHub's native secret scanning and push protection, which are
repository settings rather than workflow steps. Confirm both are enabled under
**Settings → Code security**; they are free for public repositories. The
generated report does not claim secret-scanning coverage, because this pipeline
does not perform it.

## Who owns the assessment

The plugin is designed so that **each deployment supplies its own Google OAuth
client** — Client ID and Secret live in the host's NocoBase Variables and
Secrets, never in this codebase. Consequently the CASA obligation attaches to
whoever publishes the OAuth client and consents users, not to this repository.

For a customer deployment you configure on their behalf, the practical split is:

- **They** receive the CASA notification, engage the lab, and hold the Letter of
  Assessment, because the OAuth client is theirs.
- **You** supply the developer-side evidence: this bundle, the scan config, the
  architecture and data-flow description, and the privacy policy and terms.

Keep that boundary explicit in writing. An assessor asking "who is the
developer of record" should not get an improvised answer.

## Not automated — still yours to do

The pipeline covers SAST, SCA, and SBOM. CASA is broader. At minimum, expect to
supply by hand:

- The ASVS-derived questionnaire, answered honestly per control.
- A data-flow description: what Google data is read, where it goes, what is
  persisted. Most of this already exists in
  [`SECURITY.md`](../../SECURITY.md) and the published privacy policy.
- Evidence of encryption at rest for stored OAuth tokens
  (`src/server/services/crypto.ts`, `tokenStore.ts`).
- Evidence of per-user isolation — that one user's tokens can never serve
  another user's request. **This is the highest-risk control in the codebase and
  currently has no automated test proving it.**
- Access control and key management for the deployment.
- Incident response and vulnerability disclosure process — see
  [`SECURITY.md`](../../SECURITY.md).

## Annual revalidation

Reassessment is due within 12 months of the Letter of Assessment date. Practical
checklist:

1. Diary the LOA date the moment you receive it; revalidation is not prompted.
2. Re-run at the stricter bar: `gh workflow run security.yml -f threshold=medium`.
3. Confirm `DEFAULT_SCOPES` still matches the scopes registered in the Cloud
   console, and that both still match the privacy policy. Scope drift between
   those three is the single easiest way to fail.
4. Reassess the NocoBase pin and the dependency risk acceptance above.
5. Re-read the privacy policy against what the code now does.