# @kalpak44/plugin-noco-tools

Connect your **NocoBase** app (and its **AI employees**) to **Google Gmail** and
**Google Calendar** via user-consented OAuth.

The plugin ships:

- A **"Connect Google" block** you can drop on any page — one-click OAuth in a popup, shows the connected account and lets the user reconnect / disconnect.
- A **public OAuth callback endpoint** that Google can hit directly (no NocoBase login required for the redirect itself).
- **Automatic token rotation** — access tokens are refreshed transparently before every Gmail/Calendar call using the stored refresh token, so AI agents can keep acting on the user's behalf without re-prompting for consent.
- **REST endpoints** for the operations any HTTP client can call: list/get/send emails, list/create events, list events on shared calendars.
- **AI-plugin tool registration** — if the NocoBase AI plugin is enabled, the same operations are automatically exposed as tools any AI employee can call.
- Credentials come from NocoBase **Variables and Secrets** (not from files), so you can rotate them centrally.

## Contents

- [Install](#install)
- [Configure — Google Cloud Console](#configure--google-cloud-console)
- [Configure — NocoBase Variables and Secrets](#configure--nocobase-variables-and-secrets)
- [Use the block](#use-the-block)
- [Use with AI employees](#use-with-ai-employees)
- [REST endpoints](#rest-endpoints)
- [Token rotation & lifecycle](#token-rotation--lifecycle)
- [Uninstall / privacy](#uninstall--privacy)
- [Develop](#develop)
- [Build](#build)

## Install

1. Grab a release `.tgz` (or build it yourself — see [Build](#build)).
2. Copy the `.tgz` to your NocoBase app's `./storage/plugins/` directory.
3. In NocoBase go to **Plugin Manager** (URL: `/v/admin/`), find **Noco Tools — Google (Gmail + Calendar)** and **Enable** it.

> **NocoBase compatibility:** `>=1.6.0` (modern client-v2). This plugin does **not** register anything under the legacy `/admin/...` plugin manager.

## Configure — Google Cloud Console

1. Open <https://console.cloud.google.com/apis/credentials>.
2. **Create OAuth Client ID** → **Web application**.
3. Add authorized **redirect URI**:

   ```
   <YOUR_APP_URL>/api/googleConnections:callback
   ```

   Example for local dev:
   ```
   http://localhost:13000/api/googleConnections:callback
   ```

4. In **APIs & Services → Library** enable:
   - **Gmail API**
   - **Google Calendar API**

5. In **APIs & Services → OAuth consent screen**, add the following scopes (Google will surface them to the user on the consent page):
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`

   > While the app is in **Testing**, add every NocoBase user you want to connect as a **Test user**. Publish the OAuth consent screen for broader access.

6. Copy the **Client ID** and **Client Secret** — you'll paste them into NocoBase next.

## Configure — NocoBase Variables and Secrets

Requires the built-in **Variables and Secrets** plugin (enabled by default in recent NocoBase releases). Go to **Settings → Variables and secrets** and add:

| Name                  | Kind     | Value                                            |
| --------------------- | -------- | ------------------------------------------------ |
| `google_client_id`    | Variable | The OAuth Client ID from Google Cloud Console.   |
| `google_client_secret`| Secret   | The OAuth Client Secret from Google Cloud Console. |
| `google_redirect_uri` | Variable | *(optional)* Override redirect URI if auto-detection is wrong. |
| `app_public_url`      | Variable | *(optional)* Base URL used to build the redirect URI when the plugin can't infer it (e.g. `https://noco.mycompany.com`). |

If you can't or don't want to use Variables & Secrets, the plugin falls back to environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` *(optional)*
- `APP_PUBLIC_URL` *(optional)*

**Verify configuration** at any time:

```
POST /api/googleTools:configStatus
```

Returns `{ configured: true, redirectUri, clientIdSuffix }` when the plugin can resolve credentials.

## Use the block

1. Open any Modern-UI page (`/v/...`).
2. **Add block** → **Others** → **Connect Google**.
3. Click **Connect Google** in the block. A popup opens the Google consent screen; on success the popup closes automatically and the block flips to **Connected as `<your email>`**.
4. **Disconnect** revokes the tokens with Google and removes the row from `googleConnections`.

**Screenshot target** (this is the layout the block renders):

```
┌───────────────────────────────────────────────┐
│ 🔗 Connect Google Account       ● Not connected│
├───────────────────────────────────────────────┤
│ Connect your Google account to let AI employees│
│ read and summarize your emails, send emails on │
│ your behalf, view your calendar events, ...    │
│                                                │
│ ┌───────────────────────────┐                  │
│ │  Connect Google           │                  │
│ └───────────────────────────┘                  │
│                                                │
│ This block only shows configuration state for  │
│ the currently logged-in user.                  │
└───────────────────────────────────────────────┘
```

## Use with AI employees

If the [NocoBase AI plugin](https://docs.nocobase.com/handbook/ai) is enabled, this plugin registers these tools with `aiManager.toolsManager` on load:

| Tool name                       | Purpose                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `google.gmail.listEmails`       | List emails (Gmail search query, `maxResults` up to 50). |
| `google.gmail.getEmail`         | Read one email (headers + text + HTML bodies).           |
| `google.gmail.sendEmail`        | Send an email on the connected user's behalf.            |
| `google.calendar.listEvents`    | List events on a specific calendar (default: `primary`). |
| `google.calendar.createEvent`   | Create an event.                                         |
| `google.calendar.listSharedEvents` | List events across calendars **shared** with the user. |

Bind them to an AI employee in **Settings → AI → Employees → Tools**. Tools run in the caller's user context, so each employee acts on behalf of the user who is chatting with it — no shared service account.

> **Summarization** is intentionally not a separate tool. The employee should call `google.gmail.getEmail` and summarize the returned body itself — that leaves the whole email visible in the conversation and doesn't hard-code a summarization prompt.

## REST endpoints

Even without the AI plugin, everything is callable over HTTP. All endpoints are `POST` unless noted; auth = logged-in NocoBase user; body = JSON `{ "values": {...} }`.

| Endpoint                                | Body / query                                    | Returns                          |
| --------------------------------------- | ----------------------------------------------- | -------------------------------- |
| `POST /api/googleConnections:authorize` | —                                               | `{ authorizeUrl, redirectUri }`  |
| `GET  /api/googleConnections:callback`  | `?code&state` (called by Google, **public**)    | HTML page + `postMessage` to opener |
| `GET  /api/googleConnections:status`    | —                                               | `{ connected, googleEmail, scopes, expiresAt, status }` |
| `POST /api/googleConnections:disconnect`| —                                               | `{ connected: false }`           |
| `POST /api/googleTools:configStatus`    | —                                               | `{ configured, redirectUri, clientIdSuffix }` |
| `POST /api/googleTools:listEmails`      | `{ values: { query?, maxResults?, labelIds? } }` | Array of email summaries         |
| `POST /api/googleTools:getEmail`        | `{ values: { id } }`                             | Email detail + bodies            |
| `POST /api/googleTools:sendEmail`       | `{ values: { to, subject, body, cc?, bcc?, isHtml?, replyToMessageId? } }` | `{ id, threadId }` |
| `POST /api/googleTools:listCalendars`   | —                                                | Array of calendars               |
| `POST /api/googleTools:listEvents`      | `{ values: { calendarId?, timeMin?, timeMax?, q?, maxResults? } }` | Array of events |
| `POST /api/googleTools:createEvent`     | `{ values: { summary, start, end, description?, location?, attendees?, calendarId?, sendUpdates? } }` | Event |
| `POST /api/googleTools:listSharedEvents`| `{ values: { timeMin?, timeMax?, q?, maxResults? } }` | Events on shared calendars |

## Token rotation & lifecycle

- **Refresh tokens** are requested with `access_type=offline` and `prompt=consent`, and stored in the `googleConnections.refreshToken` column with NocoBase's `encryption` field type (encrypted at rest by NocoBase).
- Every Gmail/Calendar call goes through `ensureFreshAccessToken(userId)` — if the current access token expires within 60 seconds it is refreshed against `oauth2.googleapis.com/token` first, and the new token is persisted.
- Google normally does **not** return a new refresh token on refresh; the existing one is kept. If Google ever revokes it (user removed the app from their Google Account), the row is marked `status=error` and the block prompts the user to reconnect.
- On **disconnect**, both the access token and refresh token are revoked with Google, then the row is deleted.

## Uninstall / privacy

**By default, tokens are erased when the plugin is disabled or uninstalled.** Concretely:

- `afterDisable()` — revokes and deletes every row in `googleConnections`.
- `remove()` — same, then the collection's table is dropped by NocoBase.

If you'd like tokens to survive a disable/re-enable cycle, comment out `afterDisable()` in `src/server/plugin.ts` and rebuild.

## Develop

The repo is set up as a **standalone plugin package with a local dev app**:

```bash
# 1. Bootstrap a local NocoBase dev instance under ./app (gitignored).
#    This step is only needed once per machine, and takes a few minutes.
yarn bootstrap   # or: npm run bootstrap

# 2. Iterate on the plugin. The dev script starts NocoBase watching
#    /src changes.
yarn dev
```

The bootstrap script does the equivalent of:

```bash
mkdir -p app && cd app
nb init --skip-ui           # non-interactive install of a NocoBase source app
ln -s ../.. plugins/@kalpak44/plugin-noco-tools
nb plugin enable @kalpak44/plugin-noco-tools
```

## Build

Produces a `.tgz` you can drop into any NocoBase instance's `./storage/plugins/`.

```bash
yarn build
# → dist/kalpak44-plugin-noco-tools-<version>.tgz
```

The build script:

1. Ensures the local dev app is bootstrapped.
2. Runs `nb source build @kalpak44/plugin-noco-tools --tar`.
3. Copies the resulting tarball from `app/source/storage/tar/` to `./dist/` at the repo root.

CI: `.github/workflows/build.yml` runs the same on every tag push and uploads the `.tgz` as a release asset.

## License

MIT © kalpak44