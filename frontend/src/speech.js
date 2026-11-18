// Plays a reply sentence by sentence: the next sentence is synthesised while the
// current one plays, so speech starts quickly. Falls back to the browser's own
// en-GB voice if the local speech server is unavailable.

const cache = new Map(); // "voice|speed|sentence" -> blob URL (replays are instant)

// Web Audio analyser: measures how loud the speech is, frame by frame, for the avatar's lip sync.
let context = null;
let analyser = null;
let samples = null;

export function unlockAudio() {
  // Browsers only allow audio processing after a click or key press, so call this from those.
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") context.resume();
  } catch { /* lip sync is optional */ }
}

function connect(audio) {
  try {
    unlockAudio();
    if (!analyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize);
      analyser.connect(context.destination);
    }
    context.createMediaElementSource(audio).connect(analyser);
  } catch { /* if this fails, the audio still plays normally */ }
}

export function audioLevel() {
  if (!analyser) return null;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / samples.length); // loudness (RMS)
}

export function splitSentences(text) {
  const parts = text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) || [];
  return parts.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

async function synthesise(sentence, voice, speed, signal) {
  const key = `${voice}|${speed}|${sentence}`;
  if (cache.has(key)) return cache.get(key);
  const response = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sentence, voice, speed }),
    signal,
  });
  if (!response.ok) throw new Error("local-tts-unavailable");
  const url = URL.createObjectURL(await response.blob());
  cache.set(key, url);
  return url;
}

function browserVoice(text, speed, signal) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find((v) => v.lang === "en-GB") || null;
    utterance.lang = "en-GB";
    utterance.rate = speed;
    utterance.onend = utterance.onerror = resolve;
    signal.addEventListener("abort", () => speechSynthesis.cancel());
    speechSynthesis.speak(utterance);
  });
}

// Returns a controller: call .stop() to interrupt. onState("loading"|"speaking"|"idle"|"fallback").
export function speak(text, { voice, speed, onState }) {
  const controller = new AbortController();
  const { signal } = controller;
  let audio = null;

  (async () => {
    const sentences = splitSentences(text);
    try {
      onState("loading");
      let next = synthesise(sentences[0], voice, speed, signal);
      for (let i = 0; i < sentences.length && !signal.aborted; i++) {
        const url = await next;
        if (i + 1 < sentences.length) {
          next = synthesise(sentences[i + 1], voice, speed, signal);
          next.catch(() => {}); // handled when awaited; avoids an unhandled-rejection warning
        }
        audio = new Audio(url);
        connect(audio);
        onState("speaking");
        await new Promise((resolve) => {
          audio.onended = audio.onerror = resolve;
          signal.addEventListener("abort", resolve);
          audio.play().catch(resolve);
        });
      }
    } catch (error) {
      if (!signal.aborted && error.message === "local-tts-unavailable") {
        onState("fallback");
        await browserVoice(text, speed, signal);
      }
    } finally {
      audio?.pause();
      onState("idle");
    }
  })();

  return { stop: () => controller.abort() };
}
