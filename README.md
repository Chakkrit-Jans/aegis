# Aegis — Autonomous Pentest Orchestration Console

Aegis is an AI-driven penetration-testing **orchestration platform**. An LLM
reasoning core plans engagements and drives security tooling, streamed live to a
web console — but **every active/offensive action passes through a human
approval gate** and is locked behind recorded authorization + scope.

> ⚠️ **Authorized testing only.** Aegis refuses to run any active tool unless the
> target is (a) covered by recorded written authorization and (b) inside the
> engagement scope. Only test systems you own or have **written permission** to
> assess. You are responsible for compliance with all applicable laws.

## Architecture

```
Next.js console  ──WS/REST──►  Express backend  ──►  AI orchestrator (agent loop)
 (neon UI)                        │                     │  plans + calls tools
                                  │                     ▼
                             MongoDB + Redis      Tool registry (recon / shell)
                             (sessions, memory)   every ACTIVE tool → approval gate
```

- **Autonomous orchestration** — the agent loop plans, calls tools, reads
  results, and continues — with the operator approving each active step.
- **Approval gate** — passive tools (dns, http headers) run freely; active tools
  (port scan, shell, exploit) require an explicit operator `approve` in the UI.
- **Scope gate** — authorization + include/exclude rules enforced before any
  network action.
- **Session history** — every session (with its full transcript) and all findings
  are persisted in MongoDB. The console lists an engagement's past sessions, reopens
  any transcript read-only, and renders the Markdown report — nothing is lost on
  reload.
- **Objective templates** — pick a target category (Web, Network, OS/Host, Database,
  Firewall, Full engagement, or Exploitation & Post-Exploitation) and a level
  (Basic / Medium / Advanced) to auto-fill a well-formed objective; `<TARGET>` is
  filled from the first in-scope target, and every template ends by requiring
  findings (impact + risk + remediation) and a report.
- **Client report + PDF export** — a print-ready HTML report (cover, overall risk,
  severity summary, and every finding with evidence/impact/risk/remediation);
  "Export PDF" opens it and the browser saves a clean PDF.
- **Kali workers (multi-worker)** — real tooling (nmap, nuclei, hydra, ffuf,
  searchsploit) runs in isolated Kali containers reached only over the internal
  network via a token-gated exec agent. Run several workers in parallel and
  assign each engagement to a specific worker (isolation per client / reach
  different networks); the agent, shell, and tools all route to the engagement's
  worker. Managed from **Settings → Kali Workers**.
- **Live vuln feeds (all workers)** — nuclei templates, Exploit-DB, and nmap NSE
  scripts stay current via **manual** ("Update all" / per-feed) or **automatic**
  (scheduled) updates that run on **every enabled worker in parallel**, with
  status shown per worker. The agent can also refresh/check feeds itself
  (`update_feeds`, `feed_status`).
- **Operator terminal** — a live shell on the worker, scoped to an authorized
  engagement and fully audit-logged. The agent can also request a single command
  (`run_command`), which is approval-gated like any other intrusive step.
- **Kali desktop (VNC)** — a full XFCE desktop on the worker, in a browser tab,
  for GUI tools (Burp, Firefox) and hands-on work alongside the agent.
- **Telegram gateway** — receive approval requests on your phone with inline
  Approve/Reject buttons; decisions flow straight back into the running session.
- **Burp / Caido integration** — route active web tools (nuclei, ffuf) through an
  intercepting proxy so every request is visible in your proxy of choice.
- **RBAC + audit log** — admin/operator roles, admin-managed accounts, and an
  immutable audit trail of logins, approvals, shell commands, and config changes.
- **Provider-pluggable AI** — DeepSeek, Anthropic (Claude), or any
  OpenAI-compatible / local endpoint (Ollama, vLLM).

## Requirements

- Docker Engine 24+ with Docker Compose v2
- 4+ GB RAM, ~10 GB disk
- Node.js 22+ (local dev only)
- One AI provider API key (or a local OpenAI-compatible server)

## Quick start (Docker)

```bash
cp .env.example .env      # set AI_PROVIDER + key
docker compose up -d --build
```

- Web console: http://localhost:3000
- Backend API: http://localhost:8080
- Health check: http://localhost:8080/health

## Production deployment

Deploying to a server (Ubuntu, HTTPS, reverse proxy, firewall, backups):
see **[docs/deploy.md](docs/deploy.md)**. In short:

```bash
cp .env.example .env   # set provider key, WORKER_TOKEN, PUBLIC_DOMAIN, PUBLIC_URL
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The prod overlay binds the database/backend ports to `127.0.0.1` and puts a Caddy
reverse proxy (automatic HTTPS) in front of the console.

## Local development

```bash
# backend
cd backend && npm install && npm run dev
# frontend
cd frontend && npm install && npm run dev
```

## Authentication

The console has a login gate (JWT + bcrypt); every API route and the websocket
require a valid token. On first boot an admin account is seeded from `ADMIN_EMAIL`
/ `ADMIN_PASSWORD` (default **`admin` / `admin1234`**). If `ADMIN_PASSWORD` is left
blank, a random one is generated and printed to the backend logs. Sign in, then
change the password from the console header — always change it beyond local use.

## Usage workflow

1. Sign in, then create an **engagement**.
2. Record **authorization** and define **scope** (in-scope / excluded targets).
3. Spawn a **session** and give the agent an objective
   (e.g. "enumerate the web tier of staging.acme.test").
4. Watch the agent reason and propose actions. **Approve or reject** each active
   tool call from the console.
5. Findings and the full attack-chain transcript are saved to the engagement.

## Safety & ethics

- The scope gate + approval gate are the single chokepoints for all active
  network actions.
- The orchestrator is prompted for methodology-level guidance and authorized
  testing; it will not pursue targets outside the recorded scope.
- Engagement data lives in MongoDB and is never committed to git.

## License

MIT — intended for authorized security testing and education.
