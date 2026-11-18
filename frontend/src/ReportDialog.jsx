import { useEffect, useRef, useState } from "react";

// "Report a problem" form. Technical details are attached automatically so problems can be diagnosed.
export default function ReportDialog({ open, onClose, details }) {
  const dialog = useRef(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // hidden field that only spam bots fill in
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (open && !element.open) {
      setStatus("idle");
      setError("");
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, email, website, details }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The report could not be sent. Please try again.");
      setStatus("sent");
      setMessage("");
      setEmail("");
    } catch (e) {
      setError(e.message === "Failed to fetch" ? "The server is not reachable at the moment. Please try again later." : e.message);
      setStatus("idle");
    }
  }

  return (
    <dialog ref={dialog} className="report-dialog" onClose={onClose} aria-labelledby="report-title">
      {status === "sent" ? (
        <div className="report-done">
          <div className="report-tick" aria-hidden="true">✓</div>
          <h2 id="report-title">Thank you!</h2>
          <p>Your report has been sent. It helps make the assistant better.</p>
          <button type="button" className="search-button" onClick={onClose}>Close</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <h2 id="report-title">Report a problem</h2>
          <p className="report-intro">Tell us what went wrong. A few technical details are added automatically to help find the cause.</p>
          <label>What happened?
            <textarea required minLength={5} maxLength={2000} rows={5} value={message} autoFocus
              placeholder="For example: the voice stopped halfway through a reply."
              onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label>Your email <span className="optional">(optional, only if you would like a reply)</span>
            <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </label>
          <input className="report-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />
          <details className="report-details">
            <summary>Technical details included</summary>
            <pre>{JSON.stringify(details, null, 2)}</pre>
          </details>
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="report-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="search-button" disabled={status === "sending" || message.trim().length < 5}>
              {status === "sending" ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
