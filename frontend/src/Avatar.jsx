import { useEffect, useRef, useState } from "react";
import { audioLevel } from "./speech";

// Face settings for each expression: mouth curve, eyebrow movement and eye shape.
const EXPRESSIONS = {
  neutral:   { smile: 0.35, browY: 0,  browTilt: 0,   eyeOpen: 1,    look: [0, 0] },
  happy:     { smile: 1,    browY: -3, browTilt: 0,   eyeOpen: 0.8,  look: [0, 0] },
  concerned: { smile: -0.4, browY: -2, browTilt: 12,  eyeOpen: 1,    look: [0, 2] },
  surprised: { smile: 0,    browY: -9, browTilt: 0,   eyeOpen: 1.25, look: [0, 0] },
  thinking:  { smile: 0,    browY: -4, browTilt: -6,  eyeOpen: 1,    look: [-4, -4] },
};

// Very small rule-based mood detector for the reply text.
export function detectMood(text) {
  const t = text.toLowerCase();
  if (/\b(sorry|unfortunately|sad|afraid|difficult|condolences)\b/.test(t)) return "concerned";
  if (/\b(wow|amazing|incredible|surprising|goodness)\b|really\?/.test(t)) return "surprised";
  if (/\b(glad|great|lovely|wonderful|brilliant|happy|delighted|fantastic|pleasure|thank)\b|!/.test(t)) return "happy";
  return "neutral";
}

function mouthPath(open, smile) {
  const w = 17 - open * 3;
  const corners = 152 - smile * 3;
  const upper = 152 + smile * 5;
  const lower = upper + 2 + open * 24;
  return `M ${100 - w} ${corners} Q 100 ${upper} ${100 + w} ${corners} Q 100 ${lower} ${100 - w} ${corners} Z`;
}

const BARS = [0.45, 0.75, 1, 0.85, 0.6, 0.95, 0.5];

// Letters that float up towards the avatar: taken from the user's latest message.
function floatingLetters(text) {
  const letters = Array.from((text || "hello there").replace(/[^\p{L}]/gu, "").toLowerCase()) ;
  const source = letters.length ? letters : Array.from("hello");
  return Array.from({ length: 14 }, (_, i) => ({
    char: source[i % source.length],
    left: 8 + ((i * 37) % 84),
    delay: (i * 0.61) % 5,
    size: 14 + ((i * 7) % 12),
  }));
}

export default function Avatar({ state, mood, voice, name, text }) {
  const expression = EXPRESSIONS[state === "thinking" || state === "loading" ? "thinking" : mood] || EXPRESSIONS.neutral;
  const [blink, setBlink] = useState(false);
  const mouth = useRef(null);
  const card = useRef(null);
  const live = useRef({ state, smile: expression.smile });
  live.current.state = state;
  live.current.targetSmile = expression.smile;

  // Blink every few seconds.
  useEffect(() => {
    let timer;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        timer = setTimeout(() => { setBlink(false); schedule(); }, 140);
      }, 2500 + Math.random() * 3000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  // Lip sync: every frame, open the mouth according to the loudness of the audio being played.
  useEffect(() => {
    let frame;
    let open = 0;
    const tick = (time) => {
      const s = live.current;
      let target = 0;
      if (s.state === "speaking") {
        const level = audioLevel();
        target = level === null ? 0 : Math.min(1, Math.max(0, (level - 0.015) * 7));
      } else if (s.state === "fallback") {
        // Browser voice gives no audio data, so approximate talking movement.
        target = Math.max(0, 0.35 + 0.35 * Math.sin(time / 85) * Math.sin(time / 41));
      }
      open += (target - open) * (target > open ? 0.55 : 0.25);
      s.smile += (s.targetSmile - s.smile) * 0.08;
      mouth.current?.setAttribute("d", mouthPath(open, s.smile * (1 - open * 0.6)));
      card.current?.style.setProperty("--level", open.toFixed(3)); // drives the sound bars
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const female = voice.startsWith("bf_");
  const eyeScale = blink ? 0.1 : expression.eyeOpen;
  const [lookX, lookY] = expression.look;
  const brow = (side) => ({
    transform: `translateY(${expression.browY}px) rotate(${side * expression.browTilt}deg)`,
  });
  const label = { idle: "Listening", thinking: "Thinking…", loading: "Getting ready to speak…", speaking: "Speaking…", fallback: "Speaking…" }[state];

  return (
    <div ref={card} className={`avatar-card state-${state}`} aria-label={`${name}, your conversation partner: ${label}`}>
      <svg className={`avatar avatar-${state}`} viewBox="0 0 200 220" role="img" aria-hidden="true">
        <defs><clipPath id="avatar-frame"><circle cx="100" cy="110" r="100" /></clipPath></defs>
        <g clipPath="url(#avatar-frame)">
          <circle cx="100" cy="110" r="100" fill="#eaf3fc" />
          {female && <path d="M38 122 Q36 46 100 46 Q164 46 162 122 L164 196 Q100 212 36 196 Z" fill="#4a3426" />}
          <path d="M34 224 Q38 186 100 182 Q162 186 166 224 Z" fill="#2166ac" />
          <rect x="88" y="160" width="24" height="26" rx="8" fill="#e8b996" />
          <circle cx="48" cy="124" r="9" fill="#efc3a2" />
          <circle cx="152" cy="124" r="9" fill="#efc3a2" />
          <ellipse cx="100" cy="120" rx="52" ry="60" fill="#f4cdb0" />
          {female
            ? <path d="M47 112 Q50 54 100 54 Q150 54 153 112 Q132 82 104 80 Q72 80 47 112 Z" fill="#4a3426" />
            : <path d="M47 114 Q44 52 100 50 Q156 52 153 114 Q146 80 120 76 Q94 72 78 82 Q58 90 47 114 Z" fill="#3b2a1f" />}
          <g className="brow" style={brow(-1)}><path d="M67 97 Q78 91 89 96" stroke="#3b2a1f" strokeWidth="3.5" fill="none" strokeLinecap="round" /></g>
          <g className="brow" style={brow(1)}><path d="M111 96 Q122 91 133 97" stroke="#3b2a1f" strokeWidth="3.5" fill="none" strokeLinecap="round" /></g>
          {[78, 122].map((x) => (
            <g key={x} className="eye" style={{ transform: `scaleY(${eyeScale})` }}>
              <ellipse cx={x} cy="114" rx="9" ry="10" fill="white" />
              <circle className="iris" cx={x + lookX} cy={114 + lookY} r="5.5" fill="#24384c" />
              <circle cx={x + lookX + 2} cy={112 + lookY} r="1.6" fill="white" />
            </g>
          ))}
          <path d="M100 122 Q95 134 101 136" stroke="#d29c7c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <g className={`cheeks ${mood === "happy" && state !== "thinking" ? "show" : ""}`}>
            <circle cx="70" cy="138" r="8" fill="#f19c9c" />
            <circle cx="130" cy="138" r="8" fill="#f19c9c" />
          </g>
          <path ref={mouth} d={mouthPath(0, expression.smile)} fill="#8a3b3b" stroke="#8a3b3b" strokeWidth="3" strokeLinejoin="round" />
        </g>
      </svg>
      <strong>{name}</strong>
      <span className={`avatar-status ${state !== "idle" ? "busy" : ""}`}>{label}</span>
      <div className="avatar-stage" aria-hidden="true">
        <div className="letters">
          {floatingLetters(text).map((l, i) => (
            <span key={i} style={{ left: `${l.left}%`, animationDelay: `${l.delay}s`, fontSize: l.size }}>{l.char}</span>
          ))}
        </div>
        <div className="sound-bars">
          {BARS.map((f, i) => <span key={i} style={{ "--f": f }} />)}
        </div>
      </div>
    </div>
  );
}
