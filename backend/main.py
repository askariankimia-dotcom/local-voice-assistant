"""Backend: local LLM chat (Ollama) + local British English speech (Kokoro)."""
import io
import json
import os
import re
import wave
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from feedback import router as feedback_router

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")  # empty = pick an installed model automatically
MODELS_DIR = Path(__file__).parent / "models"
KOKORO_MODEL = Path(os.getenv("KOKORO_MODEL", MODELS_DIR / "kokoro-v1.0.int8.onnx"))
KOKORO_VOICES = Path(os.getenv("KOKORO_VOICES", MODELS_DIR / "voices-v1.0.bin"))
BRITISH_VOICES = ("bf_emma", "bf_isabella", "bf_alice", "bf_lily",
                  "bm_george", "bm_lewis", "bm_daniel", "bm_fable")

SYSTEM_PROMPT = (
    "You are a friendly, natural conversational partner from the United Kingdom. "
    "Always use British English spelling, vocabulary and idiom. "
    "Your replies are read aloud, so write the way people speak: usually one to three short sentences, "
    "no lists, headings, markdown, emoji or URLs. "
    "Be warm and polite, answer the question directly, and ask a brief follow-up question when it suits the conversation. "
    "If you do not know something, say so honestly."
)

app = FastAPI(title="Local LLM Text-to-Speech Assistant")
app.include_router(feedback_router)  # "Report a problem" form and the owner's reports page


# ---------- Local language model (Ollama) ----------

def ollama(path, payload=None, timeout=120):
    data = json.dumps(payload).encode() if payload is not None else None
    request = Request(OLLAMA_URL + path, data=data, headers={"Content-Type": "application/json"},
                      method="POST" if data else "GET")
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


_model = None


def model_name():
    """Use OLLAMA_MODEL if set; otherwise prefer an installed Qwen3 model."""
    global _model
    if OLLAMA_MODEL:
        return OLLAMA_MODEL
    if _model is None:
        names = [m["name"] for m in ollama("/api/tags", timeout=5).get("models", [])]
        if not names:
            raise HTTPException(503, "Ollama is running but has no models. Run: ollama pull qwen3:4b-instruct")
        preferred = [n for n in names if n.startswith("qwen3") and "instruct" in n] or \
                    [n for n in names if n.startswith("qwen3")] or names
        _model = preferred[0]
    return _model


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)


@app.post("/api/chat")
def chat(body: ChatRequest):
    history = [m.model_dump() for m in body.messages[-12:]]  # keep recent turns only
    payload = {"model": None, "stream": False, "think": False,
               "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *history],
               "options": {"temperature": 0.7, "num_predict": 250, "num_ctx": 4096}}
    try:
        payload["model"] = model_name()
        try:
            result = ollama("/api/chat", payload)
        except HTTPError as error:
            if error.code != 400:
                raise
            payload.pop("think")  # older Ollama or a model without a thinking switch
            result = ollama("/api/chat", payload)
    except HTTPError as error:
        raise HTTPException(502, f"Ollama error {error.code}: {error.read().decode()[:200]}") from error
    except (URLError, TimeoutError, ConnectionError) as error:
        raise HTTPException(503, "The local model is not reachable. Is Ollama running?") from error

    reply = result.get("message", {}).get("content", "")
    reply = re.sub(r"<think>.*?</think>", "", reply, flags=re.S).strip()
    if not reply:
        raise HTTPException(502, "The model returned an empty reply. Please try again.")
    return {"reply": reply, "model": payload["model"]}


# ---------- Local speech synthesis (Kokoro, British voices) ----------

_tts = None


def tts():
    global _tts
    if _tts is None:
        if not (KOKORO_MODEL.exists() and KOKORO_VOICES.exists()):
            raise HTTPException(503, "Speech model files missing. Run: python download_models.py")
        from kokoro_onnx import Kokoro
        _tts = Kokoro(str(KOKORO_MODEL), str(KOKORO_VOICES))
    return _tts


def speakable(text):
    """Remove markdown symbols and emoji that a voice should not read out."""
    text = re.sub(r"[*_#`>~|]+", " ", text)
    text = re.sub(r"[\U0001F000-\U0001FAFF☀-➿]", "", text)
    return " ".join(text.split())


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    voice: Literal[BRITISH_VOICES] = "bf_emma"
    speed: float = Field(1.0, ge=0.7, le=1.3)


@app.post("/api/speak")
def speak(body: SpeakRequest):
    text = speakable(body.text)
    if not text:
        raise HTTPException(400, "Nothing to speak.")
    samples, rate = tts().create(text, voice=body.voice, speed=body.speed, lang="en-gb")
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return Response(buffer.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/api/health")
def health():
    status = {"llm": False, "model": None, "tts": KOKORO_MODEL.exists() and KOKORO_VOICES.exists(),
              "voices": list(BRITISH_VOICES)}
    try:
        status["model"] = model_name()
        status["llm"] = True
    except Exception:
        pass
    return status


# Serve the built frontend (frontend/dist) from the same server in production.
dist = Path(__file__).parent.parent / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
