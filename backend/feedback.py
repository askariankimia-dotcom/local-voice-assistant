"""'Report a problem': users send reports; the owner reads them on a password-protected page."""
import csv
import html
import io
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

router = APIRouter()
DB_FILE = Path(os.getenv("FEEDBACK_DB", Path(__file__).parent / "data" / "reports.db"))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
basic = HTTPBasic(auto_error=False)
recent = {}  # visitor address -> times of recent reports (simple spam limit)


def database():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_FILE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("""CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        message TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}')""")
    return connection


class Report(BaseModel):
    message: str = Field(min_length=5, max_length=2000)
    email: str = Field(default="", max_length=200)
    details: dict = Field(default_factory=dict)
    website: str = ""  # hidden 'honeypot' field: people leave it empty, spam bots fill it in


@router.post("/api/feedback", status_code=201)
def send_report(report: Report, request: Request):
    if report.website:
        return {"saved": True}  # quietly ignore bots
    email = report.email.strip()
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "Please check the email address, or leave it empty.")
    details = json.dumps(report.details, ensure_ascii=False)[:4000]

    visitor = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]
    now = time.time()
    times = [t for t in recent.get(visitor, []) if now - t < 3600]
    if len(times) >= 5:
        raise HTTPException(429, "Thank you! You have sent several reports already. Please try again later.")
    recent[visitor] = times + [now]

    with closing(database()) as connection, connection:
        connection.execute("INSERT INTO reports (created_at, message, email, details_json) VALUES (?, ?, ?, ?)",
                           (datetime.now(timezone.utc).isoformat(timespec="seconds"), report.message.strip(), email, details))
    return {"saved": True}


# ---------- Owner's page (browser asks for a password) ----------

def owner(credentials: HTTPBasicCredentials | None = Depends(basic)):
    if not ADMIN_PASSWORD:
        raise HTTPException(503, "The reports page is switched off: set ADMIN_PASSWORD on the server.")
    if not credentials or not secrets.compare_digest(credentials.password.encode(), ADMIN_PASSWORD.encode()):
        raise HTTPException(401, "Password required.", headers={"WWW-Authenticate": 'Basic realm="Reports"'})


def all_reports():
    with closing(database()) as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM reports ORDER BY id DESC")]


@router.get("/admin/reports", response_class=HTMLResponse, dependencies=[Depends(owner)])
def reports_page():
    rows = "".join(f"""<tr><td>#{r['id']}<br><small>{html.escape(r['created_at'].replace('T', ' ')[:16])} UTC</small></td>
        <td class="msg">{html.escape(r['message'])}</td><td>{html.escape(r['email']) or '<small>none</small>'}</td>
        <td><details><summary>Show</summary><pre>{html.escape(json.dumps(json.loads(r['details_json']), indent=2, ensure_ascii=False))}</pre></details></td>
        <td><form method="post" action="/admin/reports/{r['id']}/delete" onsubmit="return confirm('Delete report #{r['id']}?')">
        <button>Delete</button></form></td></tr>""" for r in all_reports())
    return f"""<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Problem reports</title><style>
body{{font-family:Inter,-apple-system,Segoe UI,sans-serif;background:#f5f8fc;color:#26394d;margin:0;padding:32px}}
h1{{color:#183952;margin:0 0 4px}} p{{color:#62758a}} a.btn{{display:inline-block;background:#2166ac;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dce5ef;border-radius:10px;margin-top:18px}}
th,td{{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #edf2f7;font-size:14px}} th{{background:#eaf3fc;color:#285f94}}
td.msg{{white-space:pre-wrap;max-width:420px}} small{{color:#8a9bad}} pre{{font-size:12px;white-space:pre-wrap;max-width:360px}}
button{{border:1px solid #e3b5bb;background:#fff1f1;color:#a33a48;border-radius:6px;padding:5px 10px;cursor:pointer}}
</style></head><body><h1>Problem reports</h1><p>Sent from the “Report a problem” form. Newest first.</p>
<a class="btn" href="/admin/reports.csv">Download CSV</a>
<table><tr><th>Report</th><th>Message</th><th>Email</th><th>Technical details</th><th></th></tr>
{rows or '<tr><td colspan="5">No reports yet.</td></tr>'}</table></body></html>"""


def spreadsheet_cell(value):
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text  # stop spreadsheet formulas


@router.get("/admin/reports.csv", dependencies=[Depends(owner)])
def reports_csv():
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(["id", "created_at_utc", "message", "email", "details"])
    for r in all_reports():
        writer.writerow([spreadsheet_cell(r[k]) for k in ("id", "created_at", "message", "email", "details_json")])
    return Response(output.getvalue().encode("utf-8-sig"), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="problem-reports.csv"', "Cache-Control": "no-store"})


@router.post("/admin/reports/{report_id}/delete", dependencies=[Depends(owner)])
def delete_report(report_id: int):
    with closing(database()) as connection, connection:
        connection.execute("DELETE FROM reports WHERE id = ?", (report_id,))
    return RedirectResponse("/admin/reports", status_code=303)
