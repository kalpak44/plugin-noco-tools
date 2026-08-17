# Security Policy

## Supported versions

This is a single npm package (`@kalpak44/plugin-noco-tools`) with one active line of development. Only the **latest published release** is supported with security fixes — please upgrade before reporting an issue that may already be fixed.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities privately using GitHub's built-in reporting flow:

1. Go to the [Security tab](https://github.com/kalpak44/plugin-noco-tools/security) of this repository.
2. Click **"Report a vulnerability"** to open a private draft security advisory.

This reaches the maintainer directly without disclosing the issue publicly. If that option is unavailable, open a minimal public issue asking to be contacted privately — without any exploit details — and details can be exchanged out of band.

Please include, where relevant:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept code is welcome).
- The affected version and, if known, the affected file/function.
- Whether the issue requires a connected Google account / OAuth tokens to trigger.

This project is maintained by a single person outside of full-time hours. There is no guaranteed response SLA, but reports are taken seriously and acknowledged as soon as possible — typically within a few days.

## Scope

In scope:

- Code in this repository (`src/`) — OAuth token handling, credential storage/encryption, Gmail/Calendar API request construction, ACL/user-isolation logic, and the plugin's REST/AI-tool endpoints.

Out of scope (report upstream instead):

- Vulnerabilities in NocoBase core (`@nocobase/*`) — report to the [NocoBase project](https://github.com/nocobase/nocobase).
- Vulnerabilities in third-party npm dependencies with no NocoBase-Tools-specific exploitation path — report to the upstream package via [GitHub Advisory Database](https://github.com/advisories) or `npm audit`. Dependency alerts for this repo are tracked publicly via [Dependabot](https://github.com/kalpak44/plugin-noco-tools/security/dependabot).
- Vulnerabilities in the Google APIs themselves, or in the AI provider configured by a given NocoBase instance.
- Social engineering, physical access, or attacks requiring a already-compromised NocoBase admin account.

## Handling of sensitive data

Relevant background for anyone auditing this plugin — see the [Privacy Policy](https://noco-ai-tools.pavel-usanli.online/privacy.html) for the full picture:

- OAuth access/refresh tokens are the only persisted secret, stored using NocoBase's encrypted field type (AES at rest) in the `googleConnections` table.
- Gmail/Calendar content (message bodies, event details) is fetched on demand and is never written to the database.
- Every API call is re-scoped to the NocoBase user who initiated the request; one user's tokens are never used to serve another user's request.
- OAuth Client ID/Secret live in NocoBase Variables & Secrets, not in application data or logs.

## Disclosure policy

Please give a reasonable amount of time to investigate and ship a fix before any public disclosure. Credit will be given in the release notes / changelog unless you prefer to remain anonymous.