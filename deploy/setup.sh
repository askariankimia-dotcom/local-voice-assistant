#!/usr/bin/env bash
# One-command server setup for Ubuntu 22.04/24.04 (run as root).
# Installs Ollama + a Qwen3 model, the Python backend, the Kokoro voice,
# and Caddy for a free HTTPS address (https://<ip-with-dashes>.sslip.io).
# Safe to run again after uploading a new version of the app.
#
# Usage:  bash deploy/setup.sh                 (uses qwen3:4b-instruct)
#         MODEL=qwen3:1.7b bash deploy/setup.sh  (smaller, faster model)
set -euo pipefail

MODEL="${MODEL:-qwen3:4b-instruct}"
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/voice-assistant

echo "==> 1/6 System packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv python3-pip curl caddy rsync zstd

echo "==> 2/6 Ollama and the language model ($MODEL)"
command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_KEEP_ALIVE=-1"\n' > /etc/systemd/system/ollama.service.d/keep-loaded.conf
systemctl daemon-reload
systemctl restart ollama
sleep 3
ollama pull "$MODEL"

echo "==> 3/6 Application files"
id voice >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin voice
mkdir -p "$APP_DIR"
rsync -a --delete --exclude '.venv' --exclude 'models' --exclude 'data' --exclude 'node_modules' "$SOURCE_DIR"/ "$APP_DIR"/
if [ ! -f "$APP_DIR/frontend/dist/index.html" ]; then
  echo "ERROR: frontend/dist is missing. Use the server package, which includes the built website." >&2
  exit 1
fi

echo "==> 4/6 Python backend and British voice"
cd "$APP_DIR/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
.venv/bin/python download_models.py
chown -R voice:voice "$APP_DIR"

echo "==> 5/6 Background service"
# Password for the private reports page (created once, kept on later runs).
if [ ! -f /etc/voice-assistant.env ]; then
  echo "ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=')" > /etc/voice-assistant.env
  chmod 600 /etc/voice-assistant.env
fi
cat > /etc/systemd/system/voice-assistant.service <<EOF
[Unit]
Description=Voice Assistant (local LLM + British TTS)
After=network.target ollama.service

[Service]
User=voice
WorkingDirectory=$APP_DIR/backend
Environment=OLLAMA_MODEL=$MODEL
EnvironmentFile=/etc/voice-assistant.env
ExecStart=$APP_DIR/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8765
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now voice-assistant
systemctl restart voice-assistant

echo "==> 6/6 HTTPS address"
IP="$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${IP//./-}.sslip.io"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:8765
}
EOF
systemctl reload caddy || systemctl restart caddy

# Load the model into memory now, so the first visitor does not wait for it.
curl -fsS http://127.0.0.1:11434/api/generate -d "{\"model\":\"$MODEL\",\"prompt\":\"Hello\",\"stream\":false}" >/dev/null || true

echo
echo "Done! Your app will be live in about a minute at:"
echo "    https://$DOMAIN"
echo "Problem reports (private): https://$DOMAIN/admin/reports"
echo "    username: anything   password: $(cut -d= -f2 /etc/voice-assistant.env)"
echo "Check status:  systemctl status voice-assistant   |   Logs:  journalctl -u voice-assistant -f"
