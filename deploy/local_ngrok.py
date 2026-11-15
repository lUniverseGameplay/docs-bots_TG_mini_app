"""Windows local launcher: Docker infrastructure, host Python/Node and one ngrok URL.

Run with the Python 3.12 environment that has docs-bots dependencies installed.
Secrets stay in docs-bots/.env and child process environments, never CLI arguments.
"""

import argparse
import ctypes
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values, set_key


MINI = Path(__file__).resolve().parents[1]
STATE = MINI / ".local"
STATE_FILE = STATE / "processes.json"


def _birth(pid):
    """Windows process creation time prevents stopping a reused PID."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.c_void_p] * 4
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    times = [ctypes.c_ulonglong() for _ in range(4)]
    try:
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            return None
        return times[0].value
    finally:
        kernel.CloseHandle(handle)


def _save(state):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _spawn(name, command, cwd, env, state):
    with (STATE / f"{name}.log").open("ab") as log:
        process = subprocess.Popen(
            command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    state["processes"][name] = {"pid": process.pid, "birth": _birth(process.pid)}
    _save(state)
    return process


def _stop(state):
    for name, item in reversed(list(state.get("processes", {}).items())):
        if item.get("birth") and _birth(item["pid"]) == item["birth"]:
            subprocess.run(
                ["taskkill", "/PID", str(item["pid"]), "/T", "/F"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            print(f"Stopped {name}", flush=True)
    state["processes"] = {}
    _save(state)


def _wait_url(client, url, timeout=60, process=None):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if process and process.poll() is not None:
            raise RuntimeError(f"Process exited; see logs in {STATE}")
        try:
            response = client.get(url, headers={"ngrok-skip-browser-warning": "true"})
            if response.status_code == 200:
                return response
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError(f"Service did not become ready: {url}")


def _tool(name, candidates):
    executable = shutil.which(name)
    if executable:
        return Path(executable)
    for path in candidates:
        if path.is_file():
            return path
    raise RuntimeError(f"Executable not found: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "stop", "status"))
    parser.add_argument("--rag-dir", type=Path, default=MINI.parent / "docs-bots")
    parser.add_argument("--admin-id", type=int)
    parser.add_argument("--skip-infra", action="store_true", help="Infrastructure already prepared")
    parser.add_argument("--with-models", action="store_true", help="Explicitly prepare models and enable RAG generation")
    args = parser.parse_args()
    STATE.mkdir(exist_ok=True)
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {"processes": {}}
    if args.action == "stop":
        _stop(state)
        print("Docker data/services retained. Use compose stop to stop infrastructure.")
        return
    if args.action == "status":
        print("URL:", state.get("url", "not started"))
        for name, item in state.get("processes", {}).items():
            running = bool(item.get("birth")) and _birth(item["pid"]) == item["birth"]
            print(f"{name}: {'running' if running else 'stopped'} (PID {item['pid']})")
        return
    if any(i.get("birth") and _birth(i["pid"]) == i["birth"] for i in state["processes"].values()):
        raise RuntimeError("Local processes already running; use status or stop first")
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("Use Python 3.12 with docs-bots dependencies")
    rag = args.rag_dir.resolve()
    env_file = rag / ".env"
    values = {k: v for k, v in dotenv_values(env_file).items() if v is not None}
    admins = str(args.admin_id) if args.admin_id else values.get("MINI_APP_ADMIN_IDS", "")
    if not admins or any(not x.strip().isdigit() or not 0 < int(x.strip()) < 2**63 for x in admins.split(",")):
        raise RuntimeError("Set MINI_APP_ADMIN_IDS or pass --admin-id")
    home = Path.home()
    docker = _tool("docker", [home / "AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe"])
    ngrok = _tool("ngrok", [MINI.parent / "!ngrok/ngrok.exe", home / "Downloads/ngrok-v3-stable-windows-amd64/ngrok.exe"])
    node = _tool("node", [Path("C:/Program Files/nodejs/node.exe")])
    if not (MINI / "frontend/node_modules/vite/bin/vite.js").is_file():
        raise RuntimeError("Run npm ci in frontend first")
    infra_env = {**os.environ, **values}
    infra_env["PATH"] = str(docker.parent) + os.pathsep + os.environ["PATH"]
    compose = [str(docker), "compose", "--env-file", str(env_file), "-f", str(MINI / "deploy/compose.local.yaml")]
    bindings = json.loads(values["RAG_MODEL_BINDINGS"]) if args.with_models else {}
    state = {"processes": {}}
    _save(state)
    native_ollama = rag / "app/.tools/ollama/ollama.exe"
    ollama_env = {**os.environ, "OLLAMA_HOST": "127.0.0.1:11434",
                  "OLLAMA_MODELS": str(rag / "app/.tools/ollama/models"),
                  "CUDA_VISIBLE_DEVICES": "-1", "ROCR_VISIBLE_DEVICES": "-1", "OLLAMA_VULKAN": "0"}
    if args.with_models and native_ollama.is_file():
        with socket.socket() as sock:
            occupied = sock.connect_ex(("127.0.0.1", 11434)) == 0
        process = None if occupied else _spawn("ollama", [str(native_ollama), "serve"], MINI, ollama_env, state)
        with httpx.Client(timeout=5, trust_env=False) as client:
            _wait_url(client, "http://127.0.0.1:11434/api/tags", process=process)
    if not args.skip_infra:
        print("Starting Docker infrastructure...", flush=True)
        services = ["postgres", "redis", "rabbitmq", "qdrant", "s3"]
        if args.with_models and not native_ollama.is_file():
            services.append("ollama")
        subprocess.run(compose + ["up", "-d", "--wait", "--wait-timeout", "180"] + services, env=infra_env, check=True)
        for model in sorted({b["model_id"] for b in bindings.values() if b["provider"] == "ollama"}):
            print(f"Preparing configured model: {model}", flush=True)
            command = [str(native_ollama), "pull", model] if native_ollama.is_file() else compose + ["exec", "-T", "ollama", "ollama", "pull", model]
            with (STATE / "model-download.log").open("ab") as log:
                result = subprocess.run(command, env=ollama_env if native_ollama.is_file() else infra_env, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                raise RuntimeError(f"Model download failed: {model}; see model-download.log")
    for port in (8000, 8080, 5173, 4040):
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"Port {port} already occupied; existing processes were not stopped")
    runtime = {**os.environ, **values, "PGHOST": "127.0.0.1", "PGPORT": "55432",
               "RABBITMQ_HOST": "127.0.0.1", "REDIS_URL": "redis://127.0.0.1:6379/0",
               "QDRANT_URL": "http://127.0.0.1:6333", "S3_ENDPOINT_URL": "http://127.0.0.1:9000",
               "WORKER_SPOOL_DIR": str(STATE / "spool"), "PYTHONUNBUFFERED": "1",
               "MINI_APP_ENABLED": "true", "MINI_APP_ADMIN_IDS": admins}
    for binding in bindings.values():
        if binding["provider"] == "ollama":
            binding["endpoint"] = "http://127.0.0.1:11434"
    runtime["RAG_MODEL_BINDINGS"] = json.dumps(bindings)
    # Never give the browser development server the RAG secrets.
    public_env = {k: v for k, v in os.environ.items() if k.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "APPDATA", "LOCALAPPDATA", "USERPROFILE",
        "TEMP", "TMP", "COMSPEC", "PROGRAMFILES", "PROGRAMFILES(X86)", "NGROK_AUTHTOKEN"}}
    frontend_env = {k: v for k, v in public_env.items() if not k.startswith("NGROK_")}
    try:
        with httpx.Client(timeout=5, trust_env=False) as client:
            process = _spawn("ngrok", [str(ngrok), "http", "http://127.0.0.1:5173", "--inspect=false", "--log=stdout", "--log-format=json"], MINI, public_env, state)
            deadline = time.monotonic() + 60
            urls = []
            while time.monotonic() < deadline and not urls:
                response = _wait_url(client, "http://127.0.0.1:4040/api/tunnels", 60, process)
                urls = [t["public_url"] for t in response.json()["tunnels"] if t["public_url"].startswith("https://")]
                if not urls:
                    time.sleep(1)
            if len(urls) != 1:
                raise RuntimeError("Expected exactly one HTTPS tunnel in local ngrok")
            url = urls[0].rstrip("/")
            state["url"] = url
            _save(state)
            runtime.update(MINI_APP_URL=url, TELEGRAM_WEBHOOK_URL=url)
            frontend_env["__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"] = urlsplit(url).hostname
            # Backup once per launch before changing only the Mini App/webhook settings.
            backup = rag / "app/.tools" / f"env-before-ngrok-{time.time_ns()}.bak"
            backup.parent.mkdir(exist_ok=True)
            shutil.copy2(env_file, backup)
            for key in ("MINI_APP_ENABLED", "MINI_APP_URL", "MINI_APP_ADMIN_IDS", "TELEGRAM_WEBHOOK_URL"):
                set_key(str(env_file), key, runtime[key], quote_mode="auto")
            checks = [
                ("migrate", [sys.executable, "-m", "rag.runtime", "migrate"]),
                ("prepare", [sys.executable, "-m", "rag.runtime", "prepare"]),
            ]
            if args.with_models:
                checks.append(("models", [sys.executable, "-m", "rag.runtime", "check-models", "--role", "embedding", "--role", "generation", "--role", "injection"]))
            for name, command in checks:
                print(f"Checking {name}...", flush=True)
                with (STATE / f"{name}.log").open("wb") as log:
                    result = subprocess.run(command, cwd=rag / "app", env=runtime, stdout=log, stderr=subprocess.STDOUT)
                if result.returncode:
                    raise RuntimeError(f"{name} failed; see {STATE / (name + '.log')}")
            api = _spawn("rag-api", [sys.executable, "-m", "uvicorn", "rag.rag_api.application:app", "--host", "127.0.0.1", "--port", "8000", "--no-access-log"], rag / "app", runtime, state)
            _wait_url(client, "http://127.0.0.1:8000/health/ready", process=api)
            for role in ("relay", "results", "maintenance", "recovery") + (("questions",) if args.with_models else ()):
                _spawn(role, [sys.executable, "-m", "rag.runtime", "serve", role], rag / "app", runtime, state)
            backend_env = {**frontend_env, "RAG_API_BASE_URL": "http://127.0.0.1:8000", "MINI_APP_PUBLIC_ORIGIN": url,
                           "MINI_APP_LOCAL_NO_MODELS": "false" if args.with_models else "true"}
            backend = _spawn("mini-backend", [sys.executable, "-m", "uvicorn", "miniapp.app:app", "--host", "127.0.0.1", "--port", "8080", "--no-access-log"], MINI / "backend", backend_env, state)
            _wait_url(client, "http://127.0.0.1:8080/health/ready", process=backend)
            frontend = _spawn("mini-frontend", [str(node), str(MINI / "frontend/node_modules/vite/bin/vite.js"), "--port", "5173", "--strictPort"], MINI / "frontend", frontend_env, state)
            _wait_url(client, "http://127.0.0.1:5173/", process=frontend)
            for name, item in state["processes"].items():
                if not item["birth"] or _birth(item["pid"]) != item["birth"]:
                    raise RuntimeError(f"{name} exited; check its log")
            _wait_url(client, url + "/health/ready")
            # Explicit bot configuration, without dropping pending updates or sending messages.
            token = values["TELEGRAM_BOT_TOKEN"]
            for method, body in (
                ("setWebhook", {"url": url + "/telegram/webhook", "secret_token": values["TELEGRAM_WEBHOOK_SECRET"], "allowed_updates": ["message", "callback_query"], "drop_pending_updates": False}),
                ("setChatMenuButton", {"menu_button": {"type": "web_app", "text": "Открыть приложение", "web_app": {"url": url}}}),
            ):
                try:
                    form = {
                        key: json.dumps(value) if isinstance(value, (dict, list, bool)) else str(value)
                        for key, value in body.items()
                    }
                    response = client.post(f"https://api.telegram.org/bot{token}/{method}", data=form)
                    ok = response.status_code == 200 and response.json().get("ok") is True
                except (httpx.HTTPError, ValueError):
                    ok = False
                if not ok:
                    raise RuntimeError(f"Telegram {method} failed; local services remain running")
            for method in ("getWebhookInfo", "getChatMenuButton"):
                try:
                    response = client.post(f"https://api.telegram.org/bot{token}/{method}")
                    result = response.json()
                    data = result.get("result", {})
                    actual = data.get("url") if method == "getWebhookInfo" else data.get("web_app", {}).get("url")
                    expected = url + "/telegram/webhook" if method == "getWebhookInfo" else url
                    ok = result.get("ok") is True and isinstance(actual, str) and actual.rstrip("/") == expected
                except (httpx.HTTPError, ValueError):
                    ok = False
                if not ok:
                    raise RuntimeError(f"Telegram {method} verification failed; local services remain running")
            state["with_models"] = args.with_models
            _save(state)
            print(f"Ready: {url}\nLogs: {STATE}\nAdmin IDs: {admins}\nRAG generation: {'enabled' if args.with_models else 'disabled (local test without models)'}", flush=True)
    except Exception:
        print(f"Startup incomplete. Inspect logs/status in {STATE}; stop with this script's stop command.", flush=True)
        raise


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
