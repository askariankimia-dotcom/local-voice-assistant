# Voice Assistant: Local LLM + British English Text-to-Speech

A web-based conversational prototype. You type a message, a small **locally running LLM** writes a reply, and the reply is shown on screen and **spoken in British English** by a **local** speech engine. No cloud AI or TTS services are used.

- **Frontend:** React (Vite). Chat interface, play/stop button on each reply, speech on/off switch, voice and speaking-rate settings.
- **Backend:** Python (FastAPI).
  - `POST /api/chat` sends the conversation to the local LLM via **Ollama** (default: Qwen3 4B Instruct).
  - `POST /api/speak` turns text into a WAV file with **Kokoro-82M** (ONNX), using its British voices (Emma, Isabella, Alice, Lily, George, Lewis, Daniel, Fable).
  - `GET /api/health` reports which model and speech engine are available.
- **Low-latency speech:** replies are spoken sentence by sentence. The next sentence is synthesised while the current one plays.
- **Animated avatar:** an SVG face whose mouth follows the loudness of the speech (Web Audio analyser), with blinking, a thinking pose and simple expressions (happy, concerned, surprised) chosen from the reply text. Its look and name follow the chosen voice.
- **Report a problem:** a form (sidebar, or the Chats tab on phones) saves reports with automatic technical details in SQLite (`backend/data/reports.db`). The owner reads them at `/admin/reports` (password-protected; CSV download and delete). Spam protection: hidden honeypot field and 5 reports per hour per visitor.
- **Fallback:** if the speech model is missing, the browser's built-in en-GB voice is used, so the app still speaks.

```
Browser (React)  ──/api/chat──▶  FastAPI  ──▶  Ollama (Qwen3, local)
                 ──/api/speak─▶  FastAPI  ──▶  Kokoro TTS (local, en-GB)
```

## Requirements

- Python 3.10–3.12
- Node.js 18 or newer
- [Ollama](https://ollama.com) with a model installed, for example `ollama pull qwen3:4b-instruct`

## Install (once)

```bash
# 1. Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python download_models.py          # downloads the Kokoro speech model (~120 MB)

# 2. Frontend (in a second terminal)
cd frontend
npm install
```

## Run (development)

Make sure Ollama is running (open the Ollama app, or run `ollama serve`). Then:

```bash
# Terminal 1
cd backend && source .venv/bin/activate
uvicorn main:app --port 8765

# Terminal 2
cd frontend
npm run dev
```

Open the address Vite prints (usually http://localhost:5173).

## Run as a single web server (deployment)

```bash
cd frontend && npm run build        # creates frontend/dist
cd ../backend && source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8765
```

FastAPI now serves both the website and the API on port 8765. Put it behind a reverse proxy (e.g. nginx or Caddy) with HTTPS for public access. Ollama must run on the same server.

### One-command deployment on a fresh Ubuntu 24.04 server

Upload the project (including the built `frontend/dist`) to the server and run, as root:

```bash
bash deploy/setup.sh                      # default model: qwen3:4b-instruct
MODEL=qwen3:1.7b bash deploy/setup.sh     # optional: smaller, faster model
```

The script installs Ollama and the model, the Python backend and Kokoro voice, a systemd service, and Caddy with automatic HTTPS at `https://<server-ip-with-dashes>.sslip.io`. A server with 4 vCPUs and 8 GB RAM is enough (no GPU needed).

## Configuration (optional environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_MODEL` | first installed Qwen3 model | Which Ollama model to use, e.g. `llama3.2:3b` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Where Ollama is running |
| `ADMIN_PASSWORD` | not set (reports page off) | Password for `/admin/reports`; `deploy/setup.sh` creates one |
| `KOKORO_MODEL`, `KOKORO_VOICES` | `backend/models/...` | Paths to the speech model files |

The assistant's personality and style (British English, short spoken-style replies) are set in `SYSTEM_PROMPT` in `backend/main.py`.

## Troubleshooting

- **"The local model is not reachable"**: start Ollama and check with `ollama list`.
- **"Using browser voice"** in the sidebar: run `python download_models.py` in `backend/`.
- **Slow first reply**: the model and voice load on first use; later replies are faster.
