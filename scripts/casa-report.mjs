#!/usr/bin/env node
/**
 * casa-report.mjs — consolidate CI security scan output into a CASA AL1
 * evidence bundle.
 *
 * ADA's AL1 (formerly Tier 2) submission asks for "AST scan result(s) in plain
 * text (.txt) format" plus the config that produced them. GitHub's native
 * tooling emits SARIF and JSON and renders it in the Security tab, which is
 * good for developers and useless as a submission artifact. This script closes
 * that gap: it reads whatever scan output is present and writes a single
 * deterministic .txt report, a machine-readable summary, and a Markdown
 * digest for the GitHub Actions run summary.
 *
 * It also enforces the pass bar. ADA requires no findings tied to CWEs with a
 * high likelihood of exploit (and, on revalidation, none at medium either).
 * We approximate "likelihood of exploit" with the CVSS security-severity that
 * CodeQL attaches to each rule and the severity npm audit assigns to each
 * advisory, then exit non-zero when the configured threshold is breached — so
 * a regression fails the build instead of quietly landing on main.
 *
 * Usage:
 *   node scripts/casa-report.mjs --evidence-dir evidence [--threshold high]
 *                               [--baseline docs/casa/accepted-risks.json]
 *
 * Inputs (all optional — a missing input is reported as "not run", never
 * silently treated as a clean result):
 *   <evidence-dir>/codeql/**\/*.sarif   CodeQL SAST output
 *   <evidence-dir>/npm-audit.json       `npm audit --json`
 *   <evidence-dir>/sbom.json            CycloneDX SBOM
 *
 * Outputs:
 *   <evidence-dir>/security-risk-report.txt   <- the submittable artifact
 *   <evidence-dir>/security-risk-report.json  <- same data, machine-readable
 *   $GITHUB_STEP_SUMMARY                      <- Markdown digest (if set)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// --- CLI -------------------------------------------------------------------

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const EVIDENCE_DIR = getArg('evidence-dir', 'evidence');
const THRESHOLD = getArg('threshold', 'high').toLowerCase();
const BASELINE_PATH = getArg('baseline', 'docs/casa/accepted-risks.json');

/**
 * Severity ladder. CodeQL emits a CVSS-style `security-severity` float; npm
 * audit emits a word. Both are normalised onto this scale so one threshold
 * governs the whole report.
 */
const SEVERITY_ORDER = ['none', 'low', 'medium', 'high', 'critical'];
const rank = (s) => {
  const i = SEVERITY_ORDER.indexOf(String(s || 'none').toLowerCase());
  return i === -1 ? 0 : i;
};

/** CVSS score -> our ladder. Boundaries follow the CVSS v3.1 qualitative bands. */
const severityFromCvss = (score) => {
  const n = Number.parseFloat(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 9.0) return 'critical';
  if (n >= 7.0) return 'high';
  if (n >= 4.0) return 'medium';
  if (n > 0.0) return 'low';
  return 'none';
};

/** npm audit uses "moderate" where CVSS says "medium". */
const normaliseNpmSeverity = (s) => (s === 'moderate' ? 'medium' : s);

// --- small IO helpers ------------------------------------------------------

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const exists = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

/** Recursively collect files matching a predicate. Returns [] if dir missing. */
const walk = (dir, match, acc = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, match, acc);
    else if (match(e.name)) acc.push(full);
  }
  return acc;
};

// --- SARIF (CodeQL / any SARIF-emitting SAST) -------------------------------

/**
 * Build a ruleId -> rule metadata map. CodeQL puts most rules under
 * `tool.extensions[].rules` rather than `tool.driver.rules`, and other SARIF
 * producers do the opposite, so both are merged.
 */
const collectRules = (run) => {
  const map = new Map();
  const add = (rules) => {
    for (const r of rules || []) if (r?.id) map.set(r.id, r);
  };
  add(run?.tool?.driver?.rules);
  for (const ext of run?.tool?.extensions || []) add(ext.rules);
  return map;
};

/** Pull `external/cwe/cwe-079` style tags out into ["CWE-79"]. */
const cwesFromTags = (tags) => {
  const out = [];
  for (const tag of tags || []) {
    const m = /(?:^|\/)cwe-0*(\d+)$/i.exec(String(tag));
    if (m) out.push(`CWE-${m[1]}`);
  }
  return [...new Set(out)];
};

const parseSarif = (files) => {
  const findings = [];
  const tools = new Set();

  for (const file of files) {
    const sarif = readJson(file);
    if (!sarif) continue;

    for (const run of sarif.runs || []) {
      const driver = run?.tool?.driver;
      if (driver?.name) {
        tools.add(driver.semanticVersion ? `${driver.name} ${driver.semanticVersion}` : driver.name);
      }
      const rules = collectRules(run);

      for (const result of run.results || []) {
        const rule = rules.get(result.ruleId) || {};
        const props = rule.properties || {};
        const loc = result.locations?.[0]?.physicalLocation;

        // Prefer the rule's CVSS score; fall back to the SARIF level, which
        // only distinguishes error/warning/note.
        const severity =
          severityFromCvss(props['security-severity']) ??
          (result.level === 'error' ? 'high' : result.level === 'warning' ? 'medium' : 'low');

        findings.push({
          source: 'sast',
          ruleId: result.ruleId || '(unknown rule)',
          title: rule.shortDescription?.text || props.name || result.ruleId || '(untitled)',
          severity,
          cvss: props['security-severity'] ?? null,
          cwes: cwesFromTags(props.tags),
          file: loc?.artifactLocation?.uri || '(no location)',
          line: loc?.region?.startLine ?? null,
          message: (result.message?.text || '').replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }

  return { findings, tools: [...tools] };
};

// --- npm audit (SCA) -------------------------------------------------------

/**
 * @param audit  parsed `npm audit --json` output
 * @param scope  'sca' for the gated production dependency tree, 'toolchain'
 *               for the dev/build tree. Toolchain findings are reported in
 *               full but never gate the build — see the rationale in
 *               docs/casa/AL1-evidence.md.
 */
const parseNpmAudit = (audit, scope = 'sca') => {
  const findings = [];
  if (!audit) return findings;

  // npm >= 7 (auditReportVersion 2). Older shapes are not produced by the
  // Node 22 toolchain this project pins, so they are intentionally unhandled.
  for (const [name, v] of Object.entries(audit.vulnerabilities || {})) {
    const advisories = (v.via || []).filter((x) => typeof x === 'object');
    const cwes = [...new Set(advisories.flatMap((a) => a.cwe || []))];
    const titles = advisories.map((a) => a.title).filter(Boolean);
    const urls = [...new Set(advisories.map((a) => a.url).filter(Boolean))];

    findings.push({
      source: scope,
      informational: scope === 'toolchain',
      ruleId: name,
      title: titles[0] || `Vulnerable dependency: ${name}`,
      severity: normaliseNpmSeverity(v.severity),
      cvss: advisories.find((a) => a.cvss?.score)?.cvss?.score ?? null,
      cwes,
      file: scope === 'toolchain' ? 'package-lock.json (dev tree)' : 'package-lock.json',
      line: null,
      range: v.range || null,
      // `fixAvailable` is `false`, `true`, or an object describing the fix.
      fixAvailable:
        v.fixAvailable === false
          ? 'none'
          : typeof v.fixAvailable === 'object'
            ? `${v.fixAvailable.name}@${v.fixAvailable.version}`
            : 'yes',
      message: [titles.join('; '), urls.join(' ')].filter(Boolean).join(' — '),
    });
  }

  return findings;
};

// --- accepted-risk baseline ------------------------------------------------

/**
 * Documented, deliberately accepted findings. CASA expects risk acceptance to
 * be explicit and justified rather than suppressed, so entries carry a reason
 * and are still printed in the report — just not counted toward the gate.
 */
const loadBaseline = () => {
  const baseline = readJson(BASELINE_PATH);
  if (!baseline) return { entries: [], path: BASELINE_PATH, present: false };
  return {
    entries: Array.isArray(baseline.acceptedRisks) ? baseline.acceptedRisks : [],
    path: BASELINE_PATH,
    present: true,
  };
};

const matchesBaseline = (finding, entries) =>
  entries.find(
    (e) =>
      e.id === finding.ruleId &&
      // A file-scoped acceptance only applies to that file; omit `file` to
      // accept the rule everywhere.
      (!e.file || e.file === finding.file),
  );

// --- report rendering ------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const hr = (ch = '-') => ch.repeat(78);

const renderText = (report) => {
  const L = [];
  const push = (...lines) => L.push(...lines);

  push(hr('='));
  push('CASA AL1 — AUTOMATED SECURITY RISK REPORT');
  push(hr('='));
  push('');
  push(`Application        : ${report.app.name} v${report.app.version}`);
  push(`Repository         : ${report.app.repository}`);
  push(`Commit             : ${report.run.commit}`);
  push(`Ref                : ${report.run.ref}`);
  push(`Generated (UTC)    : ${report.run.generatedAt}`);
  push(`Workflow run       : ${report.run.url || '(local run)'}`);
  push(`Failure threshold  : ${report.gate.threshold} and above`);
  push('');

  push(hr());
  push('1. SCAN COVERAGE');
  push(hr());
  push('');
  for (const s of report.scans) {
    push(`  ${pad(s.type, 6)} ${pad(s.status, 12)} ${s.tool}`);
    push(`         scope: ${s.scope}`);
    if (s.config) push(`         config: ${s.config}`);
    push('');
  }

  push(hr());
  push('2. RESULT SUMMARY');
  push(hr());
  push('');
  push(`  ${pad('SEVERITY', 10)} ${pad('SAST', 7)} ${pad('SCA', 7)} ${pad('TOOLCHAIN', 11)} TOTAL`);
  for (const sev of [...SEVERITY_ORDER].reverse()) {
    if (sev === 'none') continue;
    const c = report.counts[sev];
    push(
      `  ${pad(sev.toUpperCase(), 10)} ${pad(c.sast, 7)} ${pad(c.sca, 7)} ${pad(c.toolchain, 11)} ${c.total}`,
    );
  }
  push('');
  push('  SAST      = first-party code (gated)');
  push('  SCA       = production dependencies of the published package (gated)');
  push('  TOOLCHAIN = dev/build dependencies (informational — see section 5)');
  push('');
  push(`  Counted toward gate : ${report.gate.blocking}`);
  push(`  Informational       : ${report.gate.informational}`);
  push(`  Accepted risks      : ${report.gate.accepted} (see section 4)`);
  push(`  VERDICT             : ${report.gate.pass ? 'PASS' : 'FAIL'}`);
  push('');

  push(hr());
  push('3. FINDINGS');
  push(hr());
  push('');
  if (report.findings.length === 0) {
    push('  No findings reported by any scanner in this run.');
    push('');
  } else {
    let n = 0;
    for (const f of report.findings) {
      n += 1;
      push(`  [${n}] ${f.severity.toUpperCase()} — ${f.title}`);
      push(`      scanner : ${f.source.toUpperCase()}`);
      push(`      rule    : ${f.ruleId}`);
      push(`      cwe     : ${f.cwes.length ? f.cwes.join(', ') : '(none mapped)'}`);
      push(`      cvss    : ${f.cvss ?? '(not scored)'}`);
      push(`      location: ${f.file}${f.line ? `:${f.line}` : ''}`);
      if (f.range) push(`      affected: ${f.range}`);
      if (f.fixAvailable) push(`      fix     : ${f.fixAvailable}`);
      if (f.informational) {
        push(`      STATUS  : INFORMATIONAL — dev/build tree only, not gated`);
      }
      if (f.accepted) {
        push(`      STATUS  : ACCEPTED RISK — not counted toward the gate`);
        push(`      reason  : ${f.accepted.reason}`);
      }
      if (f.message) push(`      detail  : ${f.message}`);
      push('');
    }
  }

  push(hr());
  push('4. ACCEPTED RISKS');
  push(hr());
  push('');
  if (!report.baseline.present) {
    push(`  No baseline file at ${report.baseline.path} — nothing is suppressed.`);
  } else if (report.baseline.entries.length === 0) {
    push(`  Baseline file present at ${report.baseline.path} but declares no accepted risks.`);
  } else {
    for (const e of report.baseline.entries) {
      push(`  - ${e.id}${e.file ? ` (${e.file})` : ' (all files)'}`);
      push(`    reason  : ${e.reason || '(NO REASON GIVEN — must be justified)'}`);
      if (e.reviewBy) push(`    review  : ${e.reviewBy}`);
      push('');
    }
  }
  push('');

  push(hr());
  push('5. SCOPE NOTES FOR THE ASSESSOR');
  push(hr());
  push('');
  for (const note of report.notes) {
    // Wrap at 74 columns so the .txt stays readable in a plain viewer.
    const words = note.split(' ');
    let line = '  - ';
    for (const w of words) {
      if ((line + w).length > 74) {
        push(line.trimEnd());
        line = '    ' + w + ' ';
      } else {
        line += w + ' ';
      }
    }
    push(line.trimEnd());
    push('');
  }

  push(hr('='));
  push('END OF REPORT');
  push(hr('='));

  return L.join('\n') + '\n';
};

const renderMarkdown = (report) => {
  const L = [];
  L.push(`## ${report.gate.pass ? '✅' : '❌'} CASA AL1 security scan — ${report.gate.pass ? 'PASS' : 'FAIL'}`);
  L.push('');
  L.push(
    `Threshold: **${report.gate.threshold}** and above · Blocking: **${report.gate.blocking}** · Informational: ${report.gate.informational} · Accepted: ${report.gate.accepted}`,
  );
  L.push('');
  L.push('| Severity | SAST | SCA (gated) | Toolchain (info) | Total |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const sev of [...SEVERITY_ORDER].reverse()) {
    if (sev === 'none') continue;
    const c = report.counts[sev];
    if (c.total === 0) continue;
    L.push(`| ${sev} | ${c.sast} | ${c.sca} | ${c.toolchain} | ${c.total} |`);
  }
  if (report.findings.length === 0) L.push('| _no findings_ | 0 | 0 | 0 | 0 |');
  L.push('');

  L.push('| Scan | Status | Tool | Scope |');
  L.push('| --- | --- | --- | --- |');
  for (const s of report.scans) L.push(`| ${s.type} | ${s.status} | ${s.tool} | ${s.scope} |`);
  L.push('');

  const blocking = report.findings.filter((f) => f.blocking);
  if (blocking.length) {
    L.push(`### Blocking findings (${blocking.length})`);
    L.push('');
    for (const f of blocking.slice(0, 20)) {
      L.push(`- **${f.severity}** \`${f.ruleId}\` — ${f.title}`);
      L.push(`  <br>${f.file}${f.line ? `:${f.line}` : ''} · ${f.cwes.join(', ') || 'no CWE mapped'}`);
    }
    if (blocking.length > 20) L.push(`- _…and ${blocking.length - 20} more — see the full report artifact._`);
    L.push('');
  }

  L.push('The full plain-text report is attached to this run as the `casa-al1-evidence` artifact.');
  return L.join('\n') + '\n';
};

// --- main ------------------------------------------------------------------

const pkg = readJson('package.json') || {};
const baseline = loadBaseline();

// SAST
const sarifFiles = walk(join(EVIDENCE_DIR, 'codeql'), (n) => n.endsWith('.sarif'));
const sast = parseSarif(sarifFiles);

// SCA — the gated surface: the plugin's production dependency tree.
const auditPath = join(EVIDENCE_DIR, 'npm-audit.json');
const auditRan = exists(auditPath);
const scaFindings = parseNpmAudit(readJson(auditPath), 'sca');

// SCA — informational: the dev/build toolchain tree. Reported in full because
// an assessor should see the whole inherited surface, but not gated on, since
// nothing here is reachable from the published package and the advisories are
// upstream NocoBase frontend dependencies this project cannot patch.
const devAuditPath = join(EVIDENCE_DIR, 'npm-audit-dev.json');
const devAuditRan = exists(devAuditPath);
const toolchainFindings = parseNpmAudit(readJson(devAuditPath), 'toolchain');

// SBOM
const sbomPath = join(EVIDENCE_DIR, 'sbom.json');
const sbom = readJson(sbomPath);
const componentCount = Array.isArray(sbom?.components) ? sbom.components.length : null;

// Merge, annotate with acceptance + gate status, and sort worst-first.
const findings = [...sast.findings, ...scaFindings, ...toolchainFindings]
  .map((f) => {
    const accepted = matchesBaseline(f, baseline.entries);
    return {
      ...f,
      accepted: accepted || null,
      // Informational findings are never blocking regardless of severity.
      blocking: !f.informational && !accepted && rank(f.severity) >= rank(THRESHOLD),
    };
  })
  .sort((a, b) => rank(b.severity) - rank(a.severity) || a.ruleId.localeCompare(b.ruleId));

// Counts per severity, split by scanner surface.
const counts = {};
for (const sev of SEVERITY_ORDER) counts[sev] = { sast: 0, sca: 0, toolchain: 0, total: 0 };
for (const f of findings) {
  const bucket = counts[f.severity] || counts.none;
  bucket[f.source] += 1;
  bucket.total += 1;
}

const blockingCount = findings.filter((f) => f.blocking).length;
const acceptedCount = findings.filter((f) => f.accepted).length;
const informationalCount = findings.filter((f) => f.informational).length;

const scans = [
  {
    type: 'SAST',
    status: sarifFiles.length ? 'completed' : 'NOT RUN',
    tool: sast.tools.length ? sast.tools.join(', ') : 'CodeQL (no SARIF found)',
    scope: 'src/, scripts/, site/ — see .github/codeql/codeql-config.yml',
    config: '.github/codeql/codeql-config.yml (rule set: security-extended)',
  },
  {
    type: 'SCA',
    status: auditRan ? 'completed' : 'NOT RUN',
    tool: 'npm audit (GitHub Advisory Database)',
    scope: 'production dependency tree of the published package — GATED',
    config: 'npm audit --omit=dev --json',
  },
  {
    type: 'SCA',
    status: devAuditRan ? 'completed' : 'NOT RUN',
    tool: 'npm audit (GitHub Advisory Database)',
    scope: 'dev/build toolchain tree — INFORMATIONAL, not gated (see section 5)',
    config: 'npm audit --json',
  },
  {
    type: 'SBOM',
    status: componentCount === null ? 'NOT RUN' : 'completed',
    tool: 'CycloneDX (@cyclonedx/cyclonedx-npm)',
    scope: componentCount === null ? 'n/a' : `${componentCount} components inventoried`,
    config: 'evidence/sbom.json (CycloneDX JSON)',
  },
];

const notes = [
  'This plugin declares no production dependencies. The published tarball contains compiled first-party code only: every @nocobase/* package and zod is a peerDependency resolved from the host NocoBase installation at runtime. That is why the gated SCA row reports an empty dependency tree — it is an accurate result, not a scan that failed to run.',
  'The TOOLCHAIN row covers dev dependencies, which exist so that CI can typecheck the plugin against the NocoBase API surface it compiles against. Those advisories are overwhelmingly inherited from the @nocobase/client frontend chain (mermaid, pdfjs-dist, dompurify, @ant-design/pro-layout and similar). They are reported in full rather than suppressed, but they are not gated on, for three reasons: none of that code is present in the published package, none of it executes at plugin runtime, and the majority have no upstream fix available at the pinned NocoBase version. Gating on them would hold this repository hostage to another project\'s release schedule and would train reviewers to ignore a permanently red build.',
  'The advisory posture of the host NocoBase runtime — the tree the plugin actually executes inside — is the deploying operator\'s responsibility and is tracked separately by the scheduled runtime-audit job in .github/workflows/security.yml. See also SECURITY.md "Out of scope" and the risk-acceptance rationale in .github/dependabot.yml.',
  'The plugin is distributed as a NocoBase plugin, not a standalone service. It has no independently deployable HTTP surface: its REST endpoints are mounted inside the host NocoBase application and inherit that application\'s authentication, session handling, TLS termination, and network exposure. Dynamic testing (DAST) of those endpoints is therefore only meaningful against a deployed host instance, and is out of scope for this repository-level pipeline.',
  'Severity is normalised onto a single CVSS-derived scale so one threshold governs both scanners: CodeQL rule security-severity scores are banded per CVSS v3.1, and npm audit\'s "moderate" is mapped to "medium". CASA\'s pass bar is expressed as likelihood of exploit rather than CVSS, so this is an approximation chosen to be conservative — it never downgrades a finding.',
  'A "NOT RUN" status in section 1 means no output file was found for that scanner, not that the scanner found nothing. Absence of evidence is reported as absence of evidence.',
];

const report = {
  app: {
    name: pkg.name || '(unknown)',
    version: pkg.version || '(unknown)',
    repository: pkg.repository?.url || pkg.homepage || '(unknown)',
  },
  run: {
    commit: process.env.GITHUB_SHA || '(local)',
    ref: process.env.GITHUB_REF || '(local)',
    // Injected by CI so the report is reproducible from the run record.
    generatedAt: process.env.CASA_REPORT_TIMESTAMP || new Date().toISOString(),
    url:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
  },
  scans,
  counts,
  findings,
  baseline,
  notes,
  gate: {
    threshold: THRESHOLD,
    blocking: blockingCount,
    accepted: acceptedCount,
    informational: informationalCount,
    pass: blockingCount === 0,
  },
};

const txtPath = join(EVIDENCE_DIR, 'security-risk-report.txt');
const jsonPath = join(EVIDENCE_DIR, 'security-risk-report.json');

writeFileSync(txtPath, renderText(report), 'utf8');
writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(report), 'utf8');
}

// Console output for the log.
console.log(`\nCASA AL1 report written to ${relative(process.cwd(), txtPath)}`);
for (const s of scans) console.log(`  ${s.type.padEnd(5)} ${s.status.padEnd(12)} ${s.scope}`);
console.log(
  `\n  findings: ${findings.length} total · ${blockingCount} blocking (>= "${THRESHOLD}") · ` +
    `${informationalCount} informational · ${acceptedCount} accepted`,
);

if (blockingCount > 0) {
  console.error(`\nFAIL: ${blockingCount} finding(s) at or above the "${THRESHOLD}" threshold.`);
  console.error(`See ${relative(process.cwd(), txtPath)} for the full report.`);
  process.exit(1);
}

console.log(`\nPASS: no findings at or above the "${THRESHOLD}" threshold.`);