#!/usr/bin/env python3
"""Capture one Tiiny video run. Requires Python 3, curl, and optionally tiiny.

Run: python3 tiiny_video_debug.py
Key: TIINY_API_KEY environment variable, otherwise a hidden interactive prompt.
Monitor without submitting: --video-id video_...
Reproduce another request: --request request.json
Logs default to ./tiiny-debug/. Videos go in a sibling videos/ folder.
Client logs cannot substitute for device kernel/NPU logs.
"""
import argparse
import datetime as dt
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from urllib.parse import quote, urlsplit


DEFAULT_REQUEST = {
    "model": "lightx2v/MiniMax-H3-Turbo",
    "prompt": "A cat that looks like the Terminator, a chrome metal skull slowly revealing under matted gray fur, a single glowing red eye, wearing a black leather biker jacket, riding a black Harley-Davidson motorcycle down a rain-soaked neon city street at night, cinematic slow motion, dramatic low angle, sparks flying from the exhaust, water splashes, moody blue and red lighting",
    "size": "832x480", "seconds": 4, "steps": 4,
    "enable_audio": False, "seed": 7,
}


def redact(text, key):
    if key:
        text = text.replace(key, "[REDACTED]")
    text = re.sub(r"(?im)((?:proxy-)?authorization:\s*)[^\r\n]+",
                  r"\1[REDACTED]", text)
    return re.sub(r'(?i)("(?:api_key|auth_key|access_token|refresh_token|password)"\s*:\s*")[^"]*',
                  r'\1[REDACTED]', text)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", default="http://api.tiiny/v1")
    p.add_argument("--output", type=Path, default=Path("tiiny-debug"))
    p.add_argument("--request", type=Path, help="Exact generation JSON instead of the built-in request")
    p.add_argument("--video-id", help="Monitor an existing job; do not submit")
    p.add_argument("--interval", type=float, default=5)
    p.add_argument("--timeout", type=float, default=3600, help="Monitoring limit in seconds")
    p.add_argument("--self-test", action="store_true")
    a = p.parse_args()
    if a.self_test:
        assert "secret" not in redact('> Authorization: Bearer secret\n{"api_key":"secret"}', "secret")
        assert "hidden" not in redact('< Authorization: Bearer hidden', "other")
        assert DEFAULT_REQUEST["size"] == "832x480"
        print("Self-test passed")
        return 0
    if a.interval <= 0 or a.timeout <= 0:
        p.error("interval and timeout must be positive")
    parsed = urlsplit(a.base_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        p.error("base-url must be an HTTP(S) URL without credentials, query, or fragment")
    if not shutil.which("curl"):
        p.error("curl is required")
    request = json.loads(a.request.read_text()) if a.request else DEFAULT_REQUEST.copy()
    if not isinstance(request, dict) or not request.get("prompt"):
        p.error("request must be a JSON object containing a prompt")
    key = os.environ.get("TIINY_API_KEY") or getpass.getpass("Tiiny API key (hidden): ")
    if not key or any(c in key for c in '\r\n"\\'):
        p.error("invalid or empty API key")
    os.umask(0o077)
    out = a.output.expanduser().resolve() / dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    out.mkdir(parents=True)
    env = dict(os.environ, LOG_LEVEL="DEBUG", NO_COLOR="1", TERM="dumb")
    env.pop("TIINY_API_KEY", None)
    stop = threading.Event()
    summary = {"started": dt.datetime.now(dt.timezone.utc).isoformat(),
               "base_url": a.base_url, "video_id": a.video_id, "outcome": "starting"}

    def save(name, value):
        text = value if isinstance(value, str) else json.dumps(value, indent=2)
        (out / name).write_text(redact(text, key) + "\n")

    def cli(name, args):
        try:
            r = subprocess.run(["tiiny", *args], capture_output=True, text=True,
                               timeout=20, env=env, cwd=out, stdin=subprocess.DEVNULL)
            save(name, f"exit_code={r.returncode}\n{r.stdout}\n{r.stderr}")
        except (OSError, subprocess.TimeoutExpired) as e:
            save(name, f"CLI capture unavailable: {type(e).__name__}")

    def http(name, path, payload=None, binary=False):
        # Pass auth through stdin, so it is absent from process arguments.
        body = out / (name + (".mp4.part" if binary else ".body.txt"))
        cmd = ["curl", "--config", "-", "--verbose", "--silent", "--show-error",
               "--connect-timeout", "10", "--max-time", "120" if payload else "30",
               "--output", str(body), "--write-out", "%{http_code}",
               "--url", a.base_url.rstrip("/") + path]
        if payload is not None:
            cmd += ["--request", "POST", "--header", "Content-Type: application/json",
                    "--data-binary", "@" + str(out / "request.json")]
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        r = subprocess.run(cmd, input=f'header = "Authorization: Bearer {key}"\n',
                           capture_output=True, text=True, env=env, cwd=out, timeout=130)
        save(name + ".curl.log", f"started={started}\ncurl_exit={r.returncode}\nHTTP={r.stdout}\n{r.stderr}")
        ok = r.returncode == 0 and r.stdout.isdigit() and 200 <= int(r.stdout) < 300
        if binary and ok and body.exists():
            with body.open("rb") as download:
                valid_mp4 = b"ftyp" in download.read(32)
            if valid_mp4:
                videos = out.parent.parent / "videos"
                videos.mkdir(exist_ok=True)
                video_path = videos / f"{out.name}.mp4"
                body.rename(video_path)
                summary["video_path"] = str(video_path)
                print(f"Video: {video_path}", flush=True)
                return True, {}
        raw = body.read_bytes() if body.exists() else b""
        save(body.name, raw.decode("utf-8", errors="replace"))
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            data = {}
        return ok and not binary, data

    def snapshot(prefix):
        cli(prefix + ".status.log", ["status", "--json"])

    def monitor():
        n = 0
        while not stop.is_set():
            snapshot(f"sample-{n:05d}")
            n += 1
            stop.wait(a.interval)

    worker = None
    print(f"Capturing to {out}", flush=True)
    try:
        save("request.json", request)
        cli("cli-help.log", ["--help"])
        snapshot("before")
        cli("loaded-before.log", ["ls", "--loaded", "--json"])
        cli("tasks-before.log", ["tasks", "ls", "--json"])
        http("health-before", "/video/health")
        http("info-before", "/video/info")
        ok, jobs = http("jobs-before", "/videos")
        if not a.video_id:
            if not ok or not isinstance(jobs, dict) or not isinstance(jobs.get("data"), list):
                raise RuntimeError("Cannot check existing jobs; no generation submitted")
            active = [v for v in jobs["data"] if v.get("status") in ("queued", "in_progress")]
            if active:
                raise RuntimeError("Active jobs exist. Use --video-id to monitor one, or wait for completion")
        worker = threading.Thread(target=monitor, daemon=True)
        worker.start()
        if not a.video_id:
            ok, job = http("submit", "/videos", payload=request)
            if isinstance(job, dict) and job.get("id"):
                summary["video_id"] = job["id"]
                save("summary.json", summary)
            if not ok or not summary["video_id"]:
                raise RuntimeError("Submission failed or was ambiguous. Check submit logs and jobs-after; do not blindly retry")
        vid = quote(str(summary["video_id"]), safe="")
        print(f"Monitoring {summary['video_id']}", flush=True)
        deadline = time.monotonic() + a.timeout
        n = 0
        while time.monotonic() < deadline:
            ok, job = http(f"poll-{n:05d}", "/videos/" + vid)
            n += 1
            if ok and isinstance(job, dict):
                status = job.get("status")
                print(f"{dt.datetime.now().isoformat(timespec='seconds')} status={status} progress={job.get('progress')}", flush=True)
                save("last-job.json", job)
                if status in ("completed", "failed", "cancelled", "canceled"):
                    summary.update(outcome=status, error=job.get("error"))
                    if status == "completed":
                        downloaded, _ = http("download", "/videos/" + vid + "/content", binary=True)
                        summary["downloaded"] = downloaded
                        if not downloaded:
                            summary["outcome"] = "download_failed"
                    break
            else:
                print("Status request failed; captured response, continuing monitoring", flush=True)
            stop.wait(min(a.interval, max(0, deadline - time.monotonic())))
        else:
            summary["outcome"] = "monitor_timeout_job_may_still_be_running"
    except KeyboardInterrupt:
        summary["outcome"] = "monitor_interrupted_job_may_still_be_running"
    except Exception as e:
        summary.update(outcome="capture_error", error=str(e))
        print(redact(str(e), key), file=sys.stderr)
    finally:
        stop.set()
        if worker:
            worker.join(timeout=25)
        snapshot("after")
        cli("loaded-after.log", ["ls", "--loaded", "--json"])
        cli("tasks-after.log", ["tasks", "ls", "--json"])
        for name, path in [("health-after", "/video/health"), ("info-after", "/video/info"), ("jobs-after", "/videos")]:
            try:
                http(name, path)
            except Exception as e:
                save(name + ".error.log", str(e))
        summary["finished"] = dt.datetime.now(dt.timezone.utc).isoformat()
        save("summary.json", summary)
        # Sanitize any files emitted by LOG_LEVEL=DEBUG before packaging.
        for f in out.rglob("*"):
            if f.is_file() and f.suffix != ".mp4":
                f.write_text(redact(f.read_text(errors="replace"), key))
        archive = shutil.make_archive(str(out), "zip", root_dir=out)
        print(f"Outcome: {summary['outcome']}\nCapture: {out}\nArchive: {archive}")
    return 0 if summary["outcome"] == "completed" else 1


if __name__ == "__main__":
    sys.exit(main())
