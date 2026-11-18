import { useEffect, useRef, useState } from "react";
import { speak, unlockAudio } from "./speech";
import Avatar, { detectMood } from "./Avatar";
import ReportDialog from "./ReportDialog";
import "./index.css";
import "./chat.css";

const VOICES = [
  ["bf_emma", "Emma (female)"], ["bf_isabella", "Isabella (female)"],
  ["bf_alice", "Alice (female)"], ["bf_lily", "Lily (female)"],
  ["bm_george", "George (male)"], ["bm_lewis", "Lewis (male)"],
  ["bm_daniel", "Daniel (male)"], ["bm_fable", "Fable (male)"],
];
const EXAMPLES = ["How are you?", "What's a nice way to spend a rainy afternoon?", "Tell me something interesting about tea."];
const MAX_CHATS = 50;

// Settings and chat history are kept in this browser only (localStorage).
function saved(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

// Put a chat (new or updated) at the top of the history list.
function upsertChat(chats, id, messages) {
  const existing = chats.find((chat) => chat.id === id);
  const firstQuestion = messages.find((m) => m.role === "user")?.content || "New chat";
  const chat = { id, title: existing?.title || firstQuestion.slice(0, 60), messages, updatedAt: Date.now() };
  return [chat, ...chats.filter((c) => c.id !== id)].slice(0, MAX_CHATS);
}

function when(time) {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Icon({ name }) {
  const paths = {
    chat: <path d="M4 5h16v11H9l-5 4Z" />,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1" /></>,
    play: <path d="M7 4v16l13-8Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
    send: <path d="M4 12 20 4l-6 16-3-7Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
    speaker: <><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
    muted: <><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="m17 9 5 6m0-6-5 6" /></>,
    flag: <path d="M5 21V4m0 0h12l-2 4 2 4H5" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Logo() {
  return (
    <svg className="brand-logo" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="13" fill="#2166ac" />
      <path d="M11 13h21v15H19l-8 6Z" fill="none" stroke="white" strokeWidth={2} strokeLinejoin="round" />
      <path d="M17 19v4m4-6v8m4-6v4" stroke="#b9ddff" strokeWidth={2} strokeLinecap="round" />
      <path d="M36 17q3 4 0 8m3-11q5 7 0 14" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function ChatList({ chats, activeId, onOpen, onDelete }) {
  if (chats.length === 0) return <p className="history-empty">Your previous chats will appear here.</p>;
  return (
    <ul className="history-list">
      {chats.map((chat) => (
        <li key={chat.id} className={chat.id === activeId ? "active" : ""}>
          <button type="button" className="history-open" onClick={() => onOpen(chat.id)}>
            <span>{chat.title}</span><small>{when(chat.updatedAt)}</small>
          </button>
          <button type="button" className="history-delete" aria-label={`Delete chat: ${chat.title}`} onClick={() => onDelete(chat.id)}>
            <Icon name="trash" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [view, setView] = useState("chat");
  const [chats, setChats] = useState(() => saved("chats", []));
  const [activeId, setActiveId] = useState(null); // null = a new chat not yet saved
  const [pendingId, setPendingId] = useState(null); // chat waiting for a reply
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [speechOn, setSpeechOn] = useState(() => saved("speechOn", true));
  const [voice, setVoice] = useState(() => saved("voice", "bf_emma"));
  const [speed, setSpeed] = useState(() => saved("speed", 1));
  const [speaking, setSpeaking] = useState({ id: null, state: "idle" });
  const [usedBrowserVoice, setUsedBrowserVoice] = useState(false);
  const [health, setHealth] = useState(null);
  const [mood, setMood] = useState("neutral");
  const [reporting, setReporting] = useState(false);
  const player = useRef(null);
  const run = useRef(0); // ignores late updates from a reply that was interrupted
  const endRef = useRef(null);

  const messages = chats.find((c) => c.id === activeId)?.messages || [];
  const thinking = pendingId !== null;
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.content || "";

  useEffect(() => { store("chats", chats); }, [chats]);
  useEffect(() => { store("speechOn", speechOn); store("voice", voice); store("speed", speed); }, [speechOn, voice, speed]);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ offline: true }));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingId, activeId]);

  function stopSpeech() {
    run.current++;
    player.current?.stop();
    player.current = null;
    setSpeaking({ id: null, state: "idle" });
  }

  function play(message) {
    unlockAudio();
    stopSpeech();
    setMood(detectMood(message.content));
    const thisRun = run.current;
    player.current = speak(message.content, {
      voice, speed,
      onState: (state) => {
        if (thisRun !== run.current) return;
        if (state === "fallback") setUsedBrowserVoice(true);
        setSpeaking(state === "idle" ? { id: null, state } : { id: message.id, state });
      },
    });
  }

  function toggleSpeech() {
    if (speechOn) stopSpeech();
    setSpeechOn(!speechOn);
  }

  function openChat(id) {
    stopSpeech();
    setActiveId(id);
    setError("");
    setMood("neutral");
    setView("chat");
  }

  function deleteChat(id) {
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    setChats((list) => list.filter((c) => c.id !== id));
    if (id === activeId) openChat(null);
  }

  async function send(text) {
    const content = text.trim();
    if (!content || thinking) return;
    unlockAudio();
    stopSpeech();
    const chatId = activeId || crypto.randomUUID();
    const history = [...messages, { id: crypto.randomUUID(), role: "user", content }];
    setChats((list) => upsertChat(list, chatId, history));
    setActiveId(chatId);
    setInput("");
    setError("");
    setPendingId(chatId);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The assistant could not reply.");
      const reply = { id: crypto.randomUUID(), role: "assistant", content: data.reply };
      setChats((list) => upsertChat(list, chatId, [...history, reply]));
      setMood(detectMood(reply.content));
      if (speechOn) play(reply);
    } catch (e) {
      setError(e.message === "Failed to fetch" ? "The assistant is offline at the moment. Please try again shortly." : e.message);
    } finally {
      setPendingId(null);
    }
  }

  function onKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  }

  const voiceName = VOICES.find(([id]) => id === voice)[1].split(" ")[0];
  const avatarState = thinking ? "thinking" : speaking.state;
  const problem = health?.offline ? "The assistant is offline at the moment. Please try again shortly."
    : health && !health.llm ? "The language model is not available right now. Please try again shortly." : "";

  const reportDetails = {
    page: view, problem_shown: error || problem || null, browser_voice_used: usedBrowserVoice,
    model_available: health?.llm ?? null, local_voice_available: health?.tts ?? null, voice,
    messages_in_chat: messages.length, browser: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight}`, time: new Date().toISOString(),
  };
  const reportButton = (
    <button type="button" className="report-link" onClick={() => setReporting(true)}><Icon name="flag" /> Report a problem</button>
  );

  return (
    <div className="explorer-app">
      <a className="skip-link" href="#workspace">Skip to conversation</a>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div><span>Kimia’s</span><strong>Voice Assistant</strong></div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {[["chat", "Conversation", ""], ["history", "Chats", "mobile-only"], ["settings", "Voice settings", ""]].map(([key, title, extra]) => (
            <button key={key} type="button" className={`nav-item ${extra} ${view === key ? "active" : ""}`}
              aria-pressed={view === key} onClick={() => setView(key)}>
              <Icon name={key} /><span>{title}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-history">
          <div className="history-heading">
            <span className="nav-label">PREVIOUS CHATS</span>
            <button type="button" className="new-chat" onClick={() => openChat(null)}><Icon name="plus" /> New chat</button>
          </div>
          <ChatList chats={chats} activeId={activeId} onOpen={openChat} onDelete={deleteChat} />
        </div>
        <div className="sidebar-report">{reportButton}</div>
      </aside>

      <main className="workspace chat-workspace" id="workspace">
        <header className={`hero ${view !== "chat" || messages.length > 0 ? "compact" : ""}`}>
          <div className="hero-bubbles" aria-hidden="true"><span /><span /><span /></div>
          <div className="hero-content">
            <div className="hero-text">
              <span className="hero-eyebrow">Local AI · Natural British English voice</span>
              <h1>{{ chat: `Have a chat with ${voiceName}`, settings: "Voice settings", history: "Previous chats" }[view]}</h1>
              <p>Ask a question or just say hello. Replies appear here and are read aloud.</p>
            </div>
            <div className="hero-actions">
              <span className="status-pill" role="status">
                <span className={`status-dot ${avatarState !== "idle" ? "busy" : ""}`} />
                {{ thinking: "Thinking…", loading: "Preparing speech…", speaking: "Speaking…", fallback: "Speaking…" }[avatarState] || "Ready"}
              </span>
              {view === "chat" && messages.length > 0 && (
                <button type="button" className="hero-button" onClick={() => openChat(null)}><Icon name="plus" /> New chat</button>
              )}
            </div>
          </div>
          <svg className="hero-waves" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
            <path className="wave back" d="M0 40 C240 10 480 70 720 40 C960 10 1200 70 1440 40 C1680 10 1920 70 2160 40 C2400 10 2640 70 2880 40 V80 H0 Z" />
            <path className="wave front" d="M0 52 C240 28 480 76 720 52 C960 28 1200 76 1440 52 C1680 28 1920 76 2160 52 C2400 28 2640 76 2880 52 V80 H0 Z" />
          </svg>
        </header>

        {view === "settings" && (
          <section className="settings-panel">
            <p className="view-intro">Choose a voice and speaking rate. The avatar’s look and name follow the voice.</p>
            <div className="search-panel settings-grid">
              <label>Voice
                <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {VOICES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label>Speaking rate: {speed.toFixed(2)}×
                <input type="range" min="0.8" max="1.2" step="0.05" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
              </label>
              <button type="button" className="search-button" onClick={() => play({ id: "test", content: "Hello! Lovely to meet you. Shall we have a chat?" })}>
                <Icon name="play" /> Test this voice
              </button>
            </div>
          </section>
        )}

        {view === "history" && (
          <section className="settings-panel">
            <p className="view-intro">Saved in this browser only. Open a chat to continue it, or delete it.</p>
            <button type="button" className="search-button" onClick={() => openChat(null)}><Icon name="plus" /> New chat</button>
            <div className="search-panel history-panel">
              <ChatList chats={chats} activeId={activeId} onOpen={openChat} onDelete={deleteChat} />
            </div>
            <div className="mobile-report">{reportButton}</div>
          </section>
        )}

        {view === "chat" && (
          <div className="chat-layout">
            <Avatar state={avatarState} mood={mood} voice={voice} name={voiceName} text={lastQuestion} />
            <section className="chat-panel" aria-label="Conversation">
              <div className="messages" aria-live="polite">
                {messages.length === 0 && (
                  <div className="welcome">
                    <span className="eyebrow">NOT SURE WHERE TO START?</span>
                    <h2>Try one of these</h2>
                    <div className="examples">
                      {EXAMPLES.map((example) => (
                        <button key={example} type="button" className="secondary-button" onClick={() => send(example)}>{example}</button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((message) => (
                  <div key={message.id} className={`message ${message.role}`}>
                    <div className="bubble">{message.content}</div>
                    {message.role === "assistant" && (
                      speaking.id === message.id ? (
                        <button type="button" className="play-button active" onClick={stopSpeech}>
                          <Icon name="stop" /> {speaking.state === "loading" ? "Preparing…" : "Stop"}
                        </button>
                      ) : (
                        <button type="button" className="play-button" onClick={() => play(message)}>
                          <Icon name="play" /> Play
                        </button>
                      )
                    )}
                  </div>
                ))}
                {pendingId && pendingId === activeId && (
                  <div className="message assistant"><div className="bubble typing"><span /><span /><span /></div></div>
                )}
                <div ref={endRef} />
              </div>

              {(error || problem) && (
                <p className="notice" role="alert">{error || problem}{" "}
                  <button type="button" className="inline-link" onClick={() => setReporting(true)}>Report this problem</button>
                </p>
              )}
              {usedBrowserVoice && <p className="notice">The local voice was unavailable, so your browser’s British voice was used instead.</p>}

              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
                <button type="button" role="switch" aria-checked={speechOn} className={`speech-switch ${speechOn ? "on" : ""}`}
                  onClick={toggleSpeech} title={speechOn ? "Speech is on: replies are read aloud" : "Speech is off"}>
                  <span className="switch-track"><span className="switch-thumb" /></span>
                  <span className="switch-label">Speech {speechOn ? "on" : "off"}</span>
                </button>
                <label htmlFor="prompt" className="sr-only">Your message</label>
                <textarea id="prompt" rows={2} value={input} maxLength={2000} placeholder="Type a message…"
                  onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} />
                <button type="submit" className="search-button" disabled={thinking || !input.trim()}>
                  <Icon name="send" /> Send
                </button>
              </form>
            </section>
          </div>
        )}
      </main>
      <ReportDialog open={reporting} onClose={() => setReporting(false)} details={reportDetails} />
    </div>
  );
}
