# Deploying Aegis on Ubuntu Server

Step-by-step production deployment on **Ubuntu Server 22.04 / 24.04 LTS (amd64)**.

> ⚠️ This host runs offensive tooling and stores client engagement data. Treat it
> as a sensitive system: dedicated VM, disk encryption, firewall, behind a VPN.
> Only assess targets you are authorized in writing to test.

---

## 0. Server spec

| Tier | CPU | RAM | Disk |
| --- | --- | --- | --- |
| Lab / PoC | 2 vCPU | 4 GB | 30 GB SSD |
| **Recommended** | **4 vCPU** | **8 GB** | **60 GB SSD** |
| Team | 8 vCPU | 16 GB | 100+ GB SSD |

Must be **x86_64/amd64** with outbound internet (tool updates + scanning).

---

## 1. Base OS prep

```bash
sudo apt update && sudo apt -y upgrade
sudo timedatectl set-timezone Asia/Bangkok
# a dedicated non-root user (skip if you already have one)
sudo adduser aegis && sudo usermod -aG sudo aegis
```

Log back in as `aegis` for the remaining steps.

---

## 2. Install Docker Engine + Compose plugin

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# run docker without sudo (log out/in afterwards)
sudo usermod -aG docker $USER
```

Verify:

```bash
docker --version && docker compose version
```

---

## 3. Get the code

```bash
sudo mkdir -p /opt/aegis && sudo chown $USER:$USER /opt/aegis
git clone <your-repo-url> /opt/aegis
cd /opt/aegis
```

(or `scp -r` the project directory to `/opt/aegis`.)

---

## 4. Configure environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:

| Variable | Set to |
| --- | --- |
| `AI_PROVIDER` | `deepseek` / `anthropic` / `openai-compatible` |
| provider key | `DEEPSEEK_API_KEY` **or** `ANTHROPIC_API_KEY` **or** `AI_BASE_URL`+`AI_API_KEY` |
| `WORKER_TOKEN` | a long random secret — `openssl rand -hex 32` |
| `JWT_SECRET` | a long random secret for signing login tokens — `openssl rand -hex 32` |
| `ADMIN_EMAIL` | first admin login (default `admin`) |
| `ADMIN_PASSWORD` | default `admin1234` — **change it for production**, or leave blank to auto-generate one (printed to logs on first boot) |
| `PUBLIC_DOMAIN` | your domain, e.g. `aegis.acme-sec.com` |
| `PUBLIC_URL` | `https://<PUBLIC_DOMAIN>` |

Generate the secrets:

```bash
echo "WORKER_TOKEN=$(openssl rand -hex 32)"   # paste into .env
echo "JWT_SECRET=$(openssl rand -hex 32)"     # paste into .env
```

---

## 5. DNS

Point an **A record** for `PUBLIC_DOMAIN` at this server's public IP. Caddy needs
it resolvable to issue the HTTPS certificate.

```bash
dig +short aegis.acme-sec.com    # should print this server's IP
```

---

## 6. Firewall

Expose only SSH + HTTP/HTTPS. The data-plane ports (8080/27017/6379) are already
bound to `127.0.0.1` by the prod overlay, so they never leave the host.

```bash
sudo apt -y install ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> Stronger: restrict SSH + 443 to your office/VPN IP, or keep the console entirely
> behind a VPN and skip opening 80/443 publicly (see §11).

---

## 7. Build & launch (production)

```bash
cd /opt/aegis
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

First build pulls the Kali image and installs the toolchain — **expect 5–15 min**.

Check everything is up:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

---

## 8. Verify

```bash
# backend health (from the host — port is localhost-only)
curl -s http://127.0.0.1:8080/health ; echo

# worker exec-agent reachable & tools present
docker compose exec worker curl -s localhost:7000/health ; echo

# public site (HTTPS via Caddy)
curl -sI https://aegis.acme-sec.com | head -n1
```

Open `https://<PUBLIC_DOMAIN>` in a browser — you'll get the **sign-in screen**.
Log in with the default `admin` / `admin1234` (or your `ADMIN_EMAIL` /
`ADMIN_PASSWORD`). If you left `ADMIN_PASSWORD` blank, grab the generated password
from the backend logs (once, on first boot):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend | grep "GENERATED password"
```

**Change the password immediately** from the console header (top-right) for any
non-local deployment.

---

## 9. First vulnerability-feed update

In the console → **Vuln Feeds** panel → **Update all** (nuclei templates pull is
~1.5 GB, a few minutes). Then enable **Auto-update** with your preferred interval.

Or via API from the host:

```bash
curl -s -X POST http://127.0.0.1:8080/api/updates/run-all | head
```

---

## 10. Harden before real engagements

- **Change the admin password** on first login (console header → Change password),
  and set a strong `ADMIN_PASSWORD` / `JWT_SECRET` in `.env`. The console has a
  built-in login gate (JWT + bcrypt); all API routes and the websocket require a
  valid token.
- For an extra network-layer gate you can still add Caddy basic-auth in front:
  add to `deploy/Caddyfile` inside the site block:
  ```
  basicauth {
      operator <bcrypt-hash>   # docker run caddy caddy hash-password --plaintext 'yourpass'
  }
  ```
  then `docker compose ... up -d` to reload.
- Rotate `WORKER_TOKEN`, `JWT_SECRET`, and any AI keys periodically. Note: rotating
  `JWT_SECRET` invalidates all active logins (everyone re-authenticates).
- Enable **full-disk encryption (LUKS)** when provisioning the VM.
- Restrict who can reach 443 (VPN / IP allow-list).

---

## 10b. Kali desktop (VNC)

The worker ships a full XFCE desktop reachable from the console's **Desktop** tab
(Burp, Firefox, GUI tooling). noVNC is bound to `127.0.0.1:6080` on the server —
it is never exposed publicly. On a remote server, tunnel it in:

```bash
ssh -L 6080:localhost:6080 aegis@<server-ip>
```

Then the Desktop tab (which loads `http://localhost:6080`) works through the tunnel.
The VNC server has no password by design — it listens on localhost only and is
reached solely via the console or the SSH tunnel (the same trust boundary as the
console). Do not publish port 6080 to a public interface.

## 11. Alternative: no public domain (VPN / SSH tunnel)

If you don't want the console on the public internet, skip Caddy and reach it over
an SSH tunnel instead:

```bash
# on your laptop
ssh -L 3000:localhost:3000 -L 8080:localhost:8080 aegis@<server-ip>
```

Run the base compose only (it binds 3000/8080 to the host):

```bash
docker compose up -d --build
```

Then browse `http://localhost:3000` locally through the tunnel. (Because the base
frontend is built with `NEXT_PUBLIC_API_URL=http://localhost:8080`, tunnel both
ports as shown.)

---

## 12. Backups

Engagement data lives in MongoDB (`./data/mongo`). Back it up regularly:

```bash
# dump into ./backups
mkdir -p backups
docker compose exec -T mongo mongodump --archive --db aegis \
  > backups/aegis-$(date +%F).archive
```

Restore:

```bash
docker compose exec -T mongo mongorestore --archive --drop < backups/aegis-YYYY-MM-DD.archive
```

Also back up `.env` (contains secrets) to a secure secret store — **not** to git.

---

## 13. Operations

```bash
# follow logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend

# update to a new version of the code
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# restart / stop
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# reclaim disk from old images
docker image prune -f
```

Containers use `restart: unless-stopped`, so the stack comes back automatically
after a reboot (Docker starts on boot by default on Ubuntu).

---

## 14. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Console loads but API calls fail | `PUBLIC_URL`/`PUBLIC_DOMAIN` mismatch, or DNS not pointing here. Check `docker compose logs caddy`. |
| Cert not issued | Port 80 blocked, or DNS A record wrong. Caddy needs inbound 80/443 + resolvable domain. |
| Tools return `worker offline/unreachable` | `WORKER_TOKEN` mismatch between backend and worker, or worker still building. `docker compose logs worker`. |
| `nuclei: not installed` | Not in the Kali repo at build time — reinstall in `worker/Dockerfile` or fetch the release binary. |
| Scans slow / OOM | Bump RAM to 8 GB+, lower scan concurrency. |
| Agent does nothing | Missing/invalid AI key, or `AI_PROVIDER` wrong. `curl 127.0.0.1:8080/health` shows the active provider/model. |
