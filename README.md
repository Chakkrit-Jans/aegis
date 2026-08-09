<div align="center">

# 🛡️ AEGIS

### Autonomous, human-in-the-loop AI penetration-testing orchestration

An LLM plans and drives an **authorized** engagement — but every active/offensive
action passes a **scope gate** and a **human approval gate** — and the result is a
client-ready report with evidence, impact and remediation.

![Open-core](https://img.shields.io/badge/model-open--core-22e0ff?style=flat-square)
![License MIT](https://img.shields.io/badge/license-MIT%20(Community)-3da639?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Next.js 14](https://img.shields.io/badge/Next.js%2014-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![Node 22](https://img.shields.io/badge/Node%2022-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Human-in-the-loop](https://img.shields.io/badge/human--in--the--loop-%E2%9C%94-39ff88?style=flat-square)

</div>

> ⚠️ **Authorized testing only.** Aegis refuses to run any active tool unless the
> target is (a) covered by recorded written authorization and (b) inside the
> engagement scope. Only test systems you own or have **written permission** to
> assess. You are responsible for compliance with all applicable laws.

---

## Why Aegis

Most "autonomous pentest" tools are a black box that runs whatever they want.
Aegis is the opposite: the AI is fast and tireless, but **you stay in control**.

| | |
| --- | --- |
| 🧠 **AI-driven** | An agent loop plans in phases (recon → scan → credential test → validate → report), calls real Kali tools, reads results, and continues. |
| 🚦 **Scope gate** | Recorded authorization + include/exclude rules are enforced before any network action — out-of-scope targets are blocked, always. |
| ✋ **Approval gate** | Passive tools run freely; every **active/intrusive** tool (port scan, dir enum, shell, exploit PoC) pauses for an explicit operator `approve` — the exact command is shown first. |
| 🧾 **Audit + RBAC** | Admin/operator roles; every approval, command and config change is written to an immutable audit log. |
| 📄 **Client report** | Findings become a print-ready HTML report (cover, overall risk, severity summary, evidence/impact/risk/remediation) → one-click **Save as PDF**. |

## Screenshots

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/screenshots/login.png" width="100%" alt="Sign in"/><br/><sub><b>Sign in</b> — every route and the websocket sit behind JWT auth.</sub></td>
    <td width="50%" valign="top"><img src="docs/screenshots/console.png" width="100%" alt="Console"/><br/><sub><b>Console</b> — the agent reasons and runs tools, findings stream in, and each active tool waits for your approval.</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><img src="docs/screenshots/report.png" width="100%" alt="Client report"/><br/><sub><b>Client report</b> — overall risk, severity summary, and every finding with evidence, impact &amp; remediation → Save as PDF.</sub></td>
    <td width="50%" valign="top"><img src="docs/screenshots/about.png" width="100%" alt="About dialog"/><br/><sub><b>About</b> — edition &amp; license, feature matrix, and system/version info.</sub></td>
  </tr>
</table>

## Architecture

```mermaid
flowchart LR
  U([Operator]) -->|approve / reject| C[Web Console<br/>Next.js]
  C <-->|WebSocket / REST| B[Backend<br/>Express + AI orchestrator]
  B --> DB[(MongoDB<br/>sessions · findings)]
  B --> RS[(Redis<br/>durable approvals)]
  B --> G{Scope + Approval Gate}
  G -->|in-scope &amp; approved| W[Kali worker<br/>nmap · nuclei · ffuf · hydra …]
  W --> T([In-scope target])
  B --> RPT[[Client report + PDF]]
```

The **worker** is the only component that touches the target, and it only runs a
tool after the gate passes. Sessions and pending approvals are durable (MongoDB +
Redis), so a backend restart never loses an in-flight engagement.

## Quick start

```bash
git clone https://github.com/Chakkrit-Jans/aegis.git
cd aegis
cp .env.example .env         # set JWT_SECRET and WORKER_TOKEN
docker compose up -d --build
```

Open **http://localhost:3000**, sign in with `admin` / `admin1234` (change it
immediately), add an AI provider in **Settings → AI Providers**, then:

```mermaid
flowchart LR
  N[New engagement] --> A[Record authorization] --> S[Set scope]
  S --> O[Pick objective] --> SP[Spawn session]
  SP --> AP{Approve / Stop} --> RE[Report + PDF]
```

> Everything is configured in the UI and stored in MongoDB — only bootstrap
> secrets (`JWT_SECRET`, `WORKER_TOKEN`, `MONGO_URL`) live in `.env`. A production
> overlay with automatic HTTPS is in [`docs/deploy.md`](docs/deploy.md).

## Features

- **Multi-worker** — real tooling runs in isolated Kali containers over a
  token-gated exec agent; assign each engagement its own worker.
- **Live vuln feeds** — nuclei templates, Exploit-DB and nmap NSE stay current
  (manual on every enabled worker).
- **Operator terminal + Kali desktop (noVNC)** — a scoped, audited shell and a
  full XFCE desktop (Burp, Firefox) in the browser.
- **Telegram gateway** — approve/reject from your phone.
- **Burp / Caido proxy** — route active web tools through your intercepting proxy.
- **Objective templates** — 7 categories × 3 levels, plus your own custom templates.
- **Provider-pluggable AI** — DeepSeek, Anthropic (Claude), or any
  OpenAI-compatible / local endpoint (Ollama, vLLM).

## Editions

Aegis is **open-core**. This repository is the free **Community Edition** — a
complete platform for a solo tester or small team. **Enterprise** adds
organization-grade capabilities, unlocked by an **Ed25519-signed license key**
pasted in **ⓘ About → Edition & License**:

| Capability | Community | Enterprise |
| --- | :---: | :---: |
| Full AI engagements · scope/approval gates · audit · reports · PDF | ✅ | ✅ |
| Personal objective templates · manual vuln-feed updates | ✅ | ✅ |
| AI providers · Kali workers | 1 each | multiple |
| SSO / OIDC · white-label reports · audit export & SIEM | 🔒 | ✅ |
| Scheduled feed updates · signed org template library | 🔒 | ✅ |

Safety features (scope gate, approval gate, audit) are **free forever** and never
gated.

## Documentation

A three-book bilingual (EN/TH) manual ships with the app — open the **📖 Docs**
button in the console, or browse [`frontend/public/manual/`](frontend/public/manual):

1. **Aegis User Guide** — setup, workflow, editions, troubleshooting
2. **WebGoat & Juice Shop** — install the practice targets
3. **Testing Aegis** — step-by-step scenarios against those targets

## Tech stack

Next.js (App Router) · Express + Socket.IO · MongoDB · Redis · Docker Compose ·
a token-gated Kali worker (nmap, nuclei, ffuf, gobuster, nikto, whatweb, hydra,
dig) with an XFCE desktop over noVNC.

## License

The **Community Edition** (this repository) is released under the **MIT License** —
see [`LICENSE`](LICENSE). The Enterprise overlay and license-signing keys are
proprietary and are **not** part of this edition.

---

<div align="center">
<sub><b>Aegis</b> — for authorized penetration testing only.</sub>
</div>
