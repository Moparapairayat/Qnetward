<div align="center">

# Qnetward

### **Network clarity, in real time.**

Diagnostics, uptime monitoring, infrastructure metrics, and security scanning for the systems you run, in one workspace your team shares.

<br />

[![CI](https://github.com/Quantum-Axis/Qnetward/actions/workflows/ci.yml/badge.svg)](https://github.com/Quantum-Axis/Qnetward/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.26-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-16.4-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![OpenAPI](https://img.shields.io/badge/API-OpenAPI_3-6BA539?style=flat-square&logo=openapiinitiative&logoColor=white)](apps/web/public/openapi.yaml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-A42E2B?style=flat-square&logo=gnu&logoColor=white)](LICENSE)

<br />

**[Live demo](https://qnetward.moparapairayat.one)　·　[API reference](https://qnetward.moparapairayat.one/docs/api)　·　[Roadmap](https://qnetward.moparapairayat.one/roadmap)　·　[Get running](#-get-running)　·　[Architecture](#-architecture)**

<br />

<img src="assets/qnetward-readme-hero.jpg" alt="Qnetward network monitoring dashboard with live latency charts and target health" width="100%" />

<br />

`PROBE` &nbsp;→&nbsp; `MONITOR` &nbsp;→&nbsp; `SECURE` &nbsp;→&nbsp; `ACT`

</div>

---

## Contents

- [What it does](#-what-it-does)
- [Our Team](#-our-team)
- [Get running](#-get-running)
- [Probe agents](#-probe-agents)
- [The CLI](#-the-cli)
- [Architecture](#-architecture)
- [API](#-api)
- [Security model](#-security-model)
- [Plans and billing](#-plans-and-billing)
- [Configuration](#-configuration)
- [Deployment](#-deployment)
- [Testing and CI](#-testing-and-ci)
- [Project status](#-project-status)
- [License](#-license)

## ◉ What it does

| &nbsp; | Area | What you get |
|:--:|:--|:--|
| ◉ | **Diagnose** | ICMP ping, TCP ping, port scans, DNS lookup with DNSSEC and mail checks, and hop-by-hop traceroute, streamed live to the browser |
| ∿ | **Monitor** | HTTP(S), TCP, and ping monitors from 30 seconds to an hour, run from the cloud and from several locations at once, with certificate-expiry warnings |
| ⚑ | **Alert** | Alert rules with thresholds and cooldowns, delivered by email, Slack, Discord, Telegram, or a signed webhook |
| ▣ | **Status pages** | Public pages with 30 days of history that update live, under names you choose |
| ⬢ | **Probe agents** | An outbound-only agent that runs monitors from private networks, reports host CPU, memory, disk, and swap, and polls network devices over SNMP |
| ⛨ | **Security scanning** | Passive checks for any domain; attack surface discovery and vulnerability findings (NVD, CISA KEV, EPSS) on domains you prove you own; deep scans only with signed consent and approval; results mapped to CIS, PCI DSS, ISO 27001, and SOC 2 |
| ⚡ | **Real time** | Every change, alert, and reading reaches open consoles in about a second, with toasts and an unseen-alert badge; agents take commands like *Run now* and *Live mode* instantly |
| ⌁ | **Teams** | Workspaces with owner, admin, member, and viewer roles, invitations, an append-only audit log, two-factor sign-in, passkeys, Google sign-in, and scoped API keys |

Everything is multi-tenant from the ground up: every row belongs to a workspace, and PostgreSQL row-level security keeps workspaces apart even if a query forgets to.

## ◉ Our Team

<table width="100%">
<tr>
<td align="center" width="25%">
  <a href="https://github.com/Fatemabintemariam">
    <img src="https://avatars.githubusercontent.com/u/270080358?v=4" width="180" height="180" alt="Fatema Binte Mariam's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/Fatemabintemariam">Fatema Binte Mariam</a></strong><br />
  Qnetward contributor
</td>
<td align="center" width="25%">
  <a href="https://github.com/Moparapairayat">
    <img src="https://avatars.githubusercontent.com/u/83800319?v=4" width="180" height="180" alt="Mopara Pair Ayat's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/Moparapairayat">Mopara Pair Ayat</a></strong><br />
  Organization member
</td>
<td align="center" width="25%">
  <a href="https://github.com/halitsever">
    <img src="https://avatars.githubusercontent.com/u/34791459?v=4" width="180" height="180" alt="Halit Sever's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/halitsever">Halit Sever</a></strong><br />
  Qnetward contributor
</td>
<td align="center" width="25%">
  <a href="https://github.com/monabber444">
    <img src="https://avatars.githubusercontent.com/u/185014085?v=4" width="180" height="180" alt="Monabber Eaman's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/monabber444">Monabber Eaman</a></strong><br />
  Qnetward contributor
</td>
</tr>
<tr>
<td align="center" width="25%">
  <a href="https://github.com/OrhanAsantr">
    <img src="https://avatars.githubusercontent.com/u/247149651?v=4" width="180" height="180" alt="Orhan Asan's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/OrhanAsantr">Orhan Asan</a></strong><br />
  Qnetward contributor
</td>
<td align="center" width="25%">
  <a href="https://github.com/NurhayatYurtaslan">
    <img src="https://avatars.githubusercontent.com/u/80510115?v=4" width="180" height="180" alt="Nurhayat Yurtaslan's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/NurhayatYurtaslan">Nurhayat Yurtaslan</a></strong><br />
  Qnetward contributor
</td>
<td align="center" width="25%">
  <a href="https://github.com/needim">
    <img src="https://avatars.githubusercontent.com/u/271912?v=4" width="180" height="180" alt="Nedim Arabacı's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/needim">Nedim Arabacı</a></strong><br />
  Qnetward contributor
</td>
<td align="center" width="25%">
  <a href="https://github.com/CodeByPinar">
    <img src="https://avatars.githubusercontent.com/u/107423523?v=4" width="180" height="180" alt="Pınar's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/CodeByPinar">Pınar</a></strong><br />
  Qnetward contributor
</td>
</tr>
<tr>
<td align="center" width="25%">
  <a href="https://github.com/edayavuz6">
    <img src="https://avatars.githubusercontent.com/u/249468949?v=4" width="180" height="180" alt="Eda Yavuz's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/edayavuz6">Eda Yavuz</a></strong><br />
  Qnetward contributor
</td>
<td align="center" width="25%">
  <a href="https://github.com/zeynepecekiris">
    <img src="https://avatars.githubusercontent.com/u/174215159?v=4" width="180" height="180" alt="Zeynep Ece Kiris's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/zeynepecekiris">Zeynep Ece Kiris</a></strong><br />
  Qnetward contributor
</td>
<td align="center" width="25%">
  <a href="https://github.com/BerattCelikk">
    <img src="https://avatars.githubusercontent.com/u/138959468?v=4" width="180" height="180" alt="Berat Erol ÇELİK's GitHub avatar" />
  </a><br />
  <strong><a href="https://github.com/BerattCelikk">Berat Erol ÇELİK</a></strong><br />
  Qnetward contributor
</td>
<td width="25%"></td>
</tr>
</table>

## ▶ Get running

### You'll need

- **Go 1.26+**
- **Node.js 22** and **pnpm 10**
- **PostgreSQL 16** (TimescaleDB optional; Neon works)
- Optional: Redis (history cache), S3-compatible storage (exports and avatars), a [Resend](https://resend.com) key (email)

### 01 — Configure

```bash
cp .env.example .env
# At minimum set QNETWARD_DB_DSN. See Configuration below for the rest.
```

`scripts/with-env.sh` runs any command with the variables from `.env` exported, values taken literally, so connection strings with `&` or `?` are safe.

### 02 — Start the API

<details open>
<summary><strong>Linux · macOS · Git Bash</strong></summary>

```bash
go build -o .tmp/qnetward ./cmd/qnetward
scripts/with-env.sh .tmp/qnetward serve
```

</details>

<details>
<summary><strong>Windows · PowerShell</strong></summary>

```powershell
go build -o .tmp\qnetward.exe .\cmd\qnetward
.\.tmp\qnetward.exe serve --listen 127.0.0.1:8080 --db-dsn "postgres://qnetward:change-me@127.0.0.1:5432/qnetward?sslmode=disable"
```

</details>

Migrations run on start. To apply or inspect them separately: `qnetward migrate` and `qnetward migrate -status`.

### 03 — Launch the console

```bash
cd apps/web
cp .env.example .env.local
pnpm install
pnpm dev
```

| Open | URL |
|:--|:--|
| **Console** | [http://localhost:3000](http://localhost:3000) |
| **API health** | [http://127.0.0.1:8080/healthz](http://127.0.0.1:8080/healthz) |
| **API reference** | [http://localhost:3000/docs/api](http://localhost:3000/docs/api) |

With `QNETWARD_DEMO_ENABLED=true`, the sign-in page offers a demo workspace, so you can look around without signing up.

> **Linux ICMP:** ping needs raw sockets. Grant them with `sudo setcap cap_net_raw+ep ./qnetward`, or run with the needed privileges.

## ⬢ Probe agents

Agents run monitors, host metrics, and SNMP polling from inside networks the cloud can't reach. They only ever connect **out** to the console: no inbound ports, no VPN.

1. In the console, open **Probe agents** and create one. You get a one-time enrollment token.
2. On the machine:

   ```bash
   qnetward agent --server https://your-console.example.com --token <enrollment token>
   ```

3. The agent swaps the token for its own secret (kept in `--state-dir`), then keeps a WebSocket open for instant commands and checks in for work.

Assign monitors to it as a location, or add network devices it should poll. Device credentials are sealed on the server and sent only to the agent assigned to that device.

## ⌨ The CLI

The same binary is a networking toolkit:

```bash
qnetward ping 8.8.8.8
qnetward tcpping example.com --port 443
qnetward portscan --ports 22,80,443 example.com
qnetward dns example.com
```

## ◈ Architecture

```mermaid
flowchart LR
    Browser[Browser] --> Proxy[nginx]
    Proxy -->|pages| Web[Next.js console]
    Proxy -->|/api, /ws| API[Go API]
    Agent[Probe agents] -->|outbound WebSocket + HTTPS| API
    CLI[CLI] --> Engines[Probe engines]
    API --> Engines
    API --> DB[(PostgreSQL<br/>row-level security)]
    DB -.->|LISTEN / NOTIFY| API
    API -->|server-sent events| Browser
    API --> Redis[(Redis cache)]
    API --> S3[(S3 storage)]
    API --> Mail[Resend email]
    API --> Pay[UddoktaPay]
```

- **A modular monolith in Go.** One binary serves the API, runs the monitor scheduler, evaluates alerts, and reconciles payments. Every instance can run them: monitors are claimed with `FOR UPDATE SKIP LOCKED`, so no two instances check the same one.
- **Live updates through PostgreSQL.** Changes are written to a `workspace_events` log; a trigger raises `NOTIFY`, every instance `LISTEN`s, and consoles receive server-sent events with replay from the last ID they saw.
- **Probe engines are plain Go packages** (`internal/engine/…`), independent of HTTP and storage, shared by the API, the agent, and the CLI.

| Path | What lives there |
|:--|:--|
| `apps/web/` | Next.js console, marketing site, docs, and public status pages |
| `cmd/qnetward/` | CLI entry point, server wiring, and the probe agent |
| `internal/api/` | HTTP, WebSocket, and server-sent event handlers |
| `internal/engine/` | Probe and scan engines: ping, TCP, ports, DNS, traceroute, HTTP, passive, surface, deep |
| `internal/store/` | PostgreSQL persistence and the embedded, versioned migrations |
| `internal/plans/` | The plan catalog: what each plan includes |
| `internal/compliance/` | Mapping of scan evidence to compliance controls |
| `internal/platform/` | Adapters: Redis, S3, email, alert channels, SNMP, vulnerability data, payments, SSRF guard |
| `deploy/` | Render image, Docker Compose, and proxy configuration |
| `docs/adr/` | 33 architecture decision records |

## ⇄ API

The full, typed reference lives at **[/docs/api](https://qnetward.moparapairayat.one/docs/api)**, generated from [`openapi.yaml`](apps/web/public/openapi.yaml).

Authenticate scripts and CI with a workspace API key:

```bash
curl https://your-console.example.com/api/monitors \
  -H "Authorization: Bearer qnw_..."
```

Subscribe to everything that happens in a workspace as it happens:

```bash
curl -N https://your-console.example.com/api/events \
  -H "Authorization: Bearer qnw_..."
```

| Method | Route | Use |
|:--|:--|:--|
| `GET` `POST` `DELETE` | `/api/monitors` | Uptime monitors |
| `POST` | `/api/monitors/run` | Run a monitor now |
| `GET` | `/api/history` | Stored probe results |
| `POST` | `/api/ping` · `/api/tcpping` · `/api/portscan` · `/api/dnslookup` | One-off diagnostics |
| `GET` | `/api/hosts` · `/api/devices` | Host metrics and network devices from agents |
| `POST` | `/api/security/passive` · `/api/security/surface` | Passive checks and attack surface scans |
| `GET` | `/api/events` | Live workspace events (server-sent events) |
| `GET` | `/api/plans` | Public plans, limits, and prices |
| `GET` | `/healthz` | Service and dependency status |

## ⛨ Security model

- **No probing of private space.** Loopback, private, link-local, carrier-grade NAT, reserved, and cloud metadata addresses are refused, checked at connect time so DNS rebinding doesn't get around it. Monitors, alert webhooks, DNS resolvers, and scans all go through the same guard. Trusted LAN installs can set `QNETWARD_ALLOW_PRIVATE_TARGETS=true`; metadata endpoints stay blocked.
- **Scanning in tiers.** Passive checks work on any domain. Active scans need proof of ownership (DNS TXT or an HTTP token). Deep scans also need a paid plan, signed consent, and a platform admin's approval.
- **Tenant isolation** with PostgreSQL row-level security under a restricted database role.
- **Accounts.** bcrypt passwords, TOTP two-factor with recovery codes, passkeys, Google sign-in with verified email only, per-account limits on wrong passwords and verification codes.
- **Secrets at rest.** Two-factor secrets and device credentials are sealed with `QNETWARD_ENCRYPTION_KEY`.
- **Every change is recorded** in an append-only audit log, kept for a year.
- **Headers.** CSP on the API, frame and clickjacking protection, HSTS, and `nosniff` on every page.

Found a vulnerability? Please report it privately to the maintainers rather than opening a public issue.

## ◇ Plans and billing

| | Free | Pro | Enterprise |
|:--|:--:|:--:|:--:|
| Monitors | 20 | 200 | 2,000 |
| Members | 25 | 100 | 1,000 |
| Probe agents | 2 | 20 | 200 |
| Status pages | 1 | 10 | 100 |
| SNMP devices | 5 | 100 | 1,000 |
| Deep scans / month | — | 10 | 100 |

The catalog lives in [`internal/plans`](internal/plans/plans.go) and the API serves it at `/api/plans`, so the site always shows what the server enforces. Pro is sold in taka through [UddoktaPay](https://uddoktapay.com) (bKash, Nagad, Rocket, cards), paid ahead a month or a year at a time, with no auto-renewal. Payments are verified with the gateway and reconciled in the background even if the browser never comes back. When a period ends, nothing is deleted: the oldest resources up to Free's limits keep running and the rest wait until the next payment.

## ⚙ Configuration

Every flag has a `QNETWARD_*` environment variable. The essentials:

| Variable | Purpose |
|:--|:--|
| `QNETWARD_DB_DSN` | PostgreSQL connection string (required) |
| `QNETWARD_PUBLIC_BASE_URL` | The console's public URL, used in emails and payment returns |
| `QNETWARD_ALLOWED_ORIGINS` | Extra origins allowed to call the API |
| `QNETWARD_ENCRYPTION_KEY` | Seals two-factor secrets and device credentials; set in production |
| `QNETWARD_ADMIN_EMAILS` | Platform administrators |
| `QNETWARD_RESEND_API_KEY` · `QNETWARD_EMAIL_FROM` | Email delivery |
| `QNETWARD_GOOGLE_CLIENT_ID` · `QNETWARD_GOOGLE_CLIENT_SECRET` | Google sign-in |
| `QNETWARD_REDIS_ADDR` | Redis cache (optional) |
| `QNETWARD_S3_ENDPOINT` · `QNETWARD_S3_BUCKET` · `QNETWARD_S3_ACCESS_KEY` · `QNETWARD_S3_SECRET_KEY` | Object storage (optional) |
| `QNETWARD_UDDOKTAPAY_URL` · `QNETWARD_UDDOKTAPAY_API_KEY` | Payments; without them nothing can be bought |
| `QNETWARD_PRO_MONTHLY_BDT` · `QNETWARD_PRO_YEARLY_BDT` | Pro's prices in taka |
| `QNETWARD_NVD_API_KEY` | Faster vulnerability lookups (optional) |
| `QNETWARD_MONITORS` | Set `false` on instances that shouldn't run the monitor scheduler |
| `QNETWARD_DB_RETENTION` | How long probe history is kept (default 7 days) |
| `QNETWARD_DEMO_ENABLED` | Offer the shared demo workspace |
| `QNETWARD_ALLOW_PRIVATE_TARGETS` | Allow private targets, for trusted LAN installs only |

`QNETWARD_DEMO_FULL_ACCESS` lifts the demo's restrictions for local testing; never enable it on a public server. Keep real secrets out of version control.

## ☁ Deployment

**Render (single container).** [`render.yaml`](render.yaml) builds [`deploy/render/Dockerfile`](deploy/render/Dockerfile): nginx in front, the Next.js console, and the Go API in one service, with Render PostgreSQL. Secrets are set in the Render dashboard. See [docs/deploy-render.md](docs/deploy-render.md).

**Docker Compose (self-hosted).** The full stack, with TimescaleDB, Redis, and MinIO:

```bash
cp .env.example .env    # set real credentials
docker compose -f deploy/docker-compose.production.yml --env-file .env up --build
```

If you expose Qnetward publicly, keep it behind the provided proxy: client addresses are read from the right end of `X-Forwarded-For`, which only works when a trusted proxy appends to it.

## ✓ Testing and CI

```bash
go vet ./...
scripts/with-env.sh go test ./...          # needs QNETWARD_TEST_POSTGRES_DSN

cd apps/web
pnpm lint && pnpm test && pnpm build      # ESLint, Vitest unit tests, production build
```

End-to-end tests run Playwright against a real API on a test database, with email delivery off so signups return their verification code:

```bash
make e2e-api                                                   # API on :8090
NEXT_PUBLIC_QNETWARD_WS_URL=ws://127.0.0.1:8090/ws pnpm --dir apps/web build
QNETWARD_BACKEND_URL=http://127.0.0.1:8090 pnpm --dir apps/web start --port 3002
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 pnpm --dir apps/web test:e2e
```

[GitHub Actions](.github/workflows/ci.yml) runs on every push: Go tests with the **race detector** against PostgreSQL, a privileged traceroute test, lint, unit tests, and a build of the console, the full Playwright suite, and both production images (Render and Compose).

## ◷ Project status

| Phase | | Status |
|:--:|:--|:--|
| 1 | Diagnose | ✅ Shipped |
| 2 | Monitor everywhere | ✅ Shipped |
| 3 | Security scanning | ✅ Shipped |
| 4 | Infrastructure & devices | 🛠 Building: hosts and SNMP devices are live; device alerts, topology, flows, logs, and cloud next |
| 5 | Automation & AI | Next |
| 6 | Developer platform: versioned public API, SDKs, Terraform | Later |
| 7 | Enterprise: SSO, SCIM, self-hosted | Later |

The details are on the [roadmap](https://qnetward.moparapairayat.one/roadmap). Design decisions are written up as [architecture decision records](docs/adr/README.md); the console has its own [development guide](apps/web/README.md).

## ⚖ License

Qnetward is free software, licensed under the **[GNU Affero General Public License v3.0](LICENSE)** (AGPL-3.0-only).

In short: you can use, study, change, and self-host it, for any purpose, including commercially. If you change it and let others use it over a network, such as running it as a hosted service, you must offer them the source of your changed version under the same license. Running it unchanged, or only for yourself and your team, asks nothing of you.

Copyright © 2026 the Qnetward contributors.

<div align="center">

---

<sub>SEE THE SIGNAL. OWN THE STACK.</sub>

</div>
