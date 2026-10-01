# Deployment: VPS + Caddy + systemd + backups

Target: a small Ubuntu 24.04 VPS (1 vCPU / 1 GB is plenty), a DNS name (e.g. `licensing.example.com`) pointing at it. You need an Anthropic API key and your **receipt key** (generated on the server below).

## 1. Prepare the server
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl ufw git openssl debian-keyring debian-archive-keyring apt-transport-https
# Node.js 22 LTS (node:sqlite needs >= 22.13)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
node -v          # v22.x
# Caddy (automatic HTTPS)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
# firewall: SSH + web only
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable
```

## 2. Install the server
```bash
sudo useradd --system --home /opt/lsr --shell /usr/sbin/nologin lsr
sudo mkdir -p /opt/lsr /etc/lsr /var/lib/lsr /var/backups/lsr
git clone https://github.com/Abdalmalek98/Energy-Tools /tmp/lsr-src && cd /tmp/lsr-src
npm ci && npm run build -w server
sudo cp server/dist/server.mjs server/dist/schema.sql /opt/lsr/
sudo cp deploy/backup.sh /opt/lsr/ && sudo chmod +x /opt/lsr/backup.sh
sudo chown -R lsr:lsr /opt/lsr /var/lib/lsr && sudo chmod 700 /var/backups/lsr
```
(To update later: pull, `npm ci && npm run build -w server`, copy the two files, `sudo systemctl restart lsr-server`.)

## 3. Keys and configuration
```bash
# the server's receipt key (generate it HERE; the private key never leaves the server)
bash scripts/gen-license-key.sh --role receipt --out /tmp/receipt-key.pem
sudo mv /tmp/receipt-key.pem /etc/lsr/receipt-key.pem && sudo chown lsr:lsr /etc/lsr/receipt-key.pem && sudo chmod 600 /etc/lsr/receipt-key.pem
```
It prints the receipt **public key** line: send it to the project owner/developer (it goes under `"receipt"` in `licensing/keys/production.json`).

Copy `licensing/keys/production.json` (your *public* licence keys) to `/etc/lsr/production.json`, then:
```bash
sudo cp .env.example /etc/lsr/server.env && sudo nano /etc/lsr/server.env   # fill ADMIN_TOKEN (openssl rand -hex 32), ANTHROPIC_API_KEY, paths
sudo chown root:lsr /etc/lsr/server.env && sudo chmod 640 /etc/lsr/server.env
```
Keep `BEHIND_PROXY=1`. The server then listens on `127.0.0.1:8443` only and **refuses to start without TLS unless that flag is set**. Optionally set `LICENSE_SIGNING_KEY_FILE` to let the License Manager create codes; the recommended way is to sign on your own PC and *import*.

## 4. Run it
```bash
sudo cp deploy/lsr-server.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lsr-server
sudo systemctl status lsr-server --no-pager
journalctl -u lsr-server -f                           # logs
# TLS: edit the hostname in deploy/Caddyfile, then
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
curl https://licensing.example.com/healthz            # {"ok":true,...}
```
Open `https://licensing.example.com/manager` and sign in with `ADMIN_TOKEN`.

## 5. Backups (do this before the first customer)
```bash
sudo crontab -e        # add:   17 3 * * * /opt/lsr/backup.sh >> /var/log/lsr-backup.log 2>&1
```
`backup.sh` writes a consistent, compressed copy (SQLite `VACUUM INTO`) every night and keeps 30 days. **Copy `/var/backups/lsr` off the server** (rsync/rclone to another machine or object storage) and **test a restore** once:
```bash
sudo systemctl stop lsr-server
gunzip -c /var/backups/lsr/licensing-YYYYMMDD-HHMMSS.sqlite.gz | sudo -u lsr tee /var/lib/lsr/licensing.sqlite >/dev/null
sudo systemctl start lsr-server
```
Also back up `/etc/lsr/` (your receipt key and env file) somewhere private: without the receipt key the app must be re-released with a new one.

## 6. Build settings for the app
In the GitHub repo → Settings → Secrets and variables → Actions → **Variables**: `LSR_SERVICE_URL` (`https://licensing.example.com`), `LSR_SUPPORT_URL` (`mailto:…` or `https://…`), `LSR_CONTACT`. Optional **secrets** for signing: `CSC_LINK` (base64 .pfx), `CSC_KEY_PASSWORD`; and `RELEASES_TOKEN` for publishing tagged releases.

## 7. Operating notes
* Updates: `sudo systemctl restart lsr-server` is safe (clients retry; offline grace covers short outages).
* Monitoring: `/healthz`; alert on it with any uptime checker.
* Costs: the VPS plus Anthropic usage. The usage log lists tokens in/out per page and model; multiply by the current Anthropic price list.
* Security updates: `sudo apt upgrade` monthly; keep Node on 22 LTS.
