/// <reference lib="webworker" />
/**
 * Web demo: the real SHMS backend (FastAPI + simulator) running inside the browser.
 *
 * Pyodide (CPython compiled to WebAssembly) loads in this worker, unpacks the backend
 * bundle (backend/app + config, zipped at build time), starts the app's lifespan (which
 * starts the simulator loop) and answers each request by calling the ASGI app directly.
 * Every visitor gets their own private mission; nothing is sent to a server.
 */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

type Req = { id: number; method: string; url: string; headers: Record<string, string>; body: string | null };

const BOOT = `
import os, sys, json, asyncio
os.makedirs("/tmp/shms", exist_ok=True)
os.environ["HUB_ROOT"] = "/shms"
os.environ["HUB_DATA_DIR"] = "/tmp/shms"
os.environ["HUB_DB"] = "/tmp/shms/hub.db"
sys.path.insert(0, "/shms/backend")

# The browser has no threads: run "sync" endpoints inline instead of in a thread pool.
import starlette.concurrency as _sc
async def _inline(func, *args, **kwargs):
    return func(*args, **kwargs)
_sc.run_in_threadpool = _inline
import fastapi.concurrency as _fc, fastapi.routing as _fr, fastapi.dependencies.utils as _fdu
for _m in (_fc, _fr, _fdu):
    if hasattr(_m, "run_in_threadpool"):
        _m.run_in_threadpool = _inline

from app.main import app
import app.api.routes as _routes
if hasattr(_routes, "run_in_threadpool"):
    _routes.run_in_threadpool = _inline

_life = app.router.lifespan_context(app)
await _life.__aenter__()

async def shms_handle(method, raw_path, query, headers_json, body):
    from urllib.parse import unquote
    path = unquote(raw_path)
    headers = json.loads(headers_json)
    raw = (body or "").encode("utf-8")
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": method, "scheme": "http", "path": path, "raw_path": raw_path.encode(),
        "query_string": query.encode(), "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]
                   + [(b"content-length", str(len(raw)).encode())],
        "client": ("127.0.0.1", 0), "server": ("demo", 80),
    }
    pending = [{"type": "http.request", "body": raw, "more_body": False}]
    async def receive():
        return pending.pop(0) if pending else {"type": "http.disconnect"}
    out = {"status": 500, "type": "application/json", "body": bytearray()}
    async def send(msg):
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]
            for k, v in msg.get("headers", []):
                if k.lower() == b"content-type":
                    out["type"] = v.decode()
        elif msg["type"] == "http.response.body":
            out["body"] += msg.get("body", b"")
    await app(scope, receive, send)
    return json.dumps({"status": out["status"], "type": out["type"], "body": out["body"].decode("utf-8", "replace")})
`;

let handle: ((...a: unknown[]) => Promise<string>) | null = null;
const queue: Req[] = [];

function post(msg: unknown) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

async function answer(r: Req) {
  try {
    const u = new URL(r.url, "http://demo");
    const res = JSON.parse(await handle!(r.method, u.pathname, u.search.replace(/^\?/, ""), JSON.stringify(r.headers), r.body));
    post({ id: r.id, ...res });
  } catch (e) {
    post({ id: r.id, status: 500, type: "application/json", body: JSON.stringify({ detail: String(e) }) });
  }
}

self.onmessage = (e: MessageEvent<{ kind: string; bundle?: string } & Req>) => {
  if (e.data.kind === "boot") void boot(e.data.bundle!);
  else if (e.data.kind === "req") {
    if (handle) void answer(e.data);
    else queue.push(e.data);
  }
};

async function boot(bundleUrl: string) {
  try {
    post({ kind: "progress", step: "runtime" });
    const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: PYODIDE });
    post({ kind: "progress", step: "packages" });
    const [bundle] = await Promise.all([
      fetch(bundleUrl).then((r) => {
        if (!r.ok) throw new Error(`backend bundle: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
      py.loadPackage(["numpy", "pyyaml", "fastapi"], { messageCallback: () => {} }),
    ]);
    post({ kind: "progress", step: "mission" });
    py.unpackArchive(bundle, "zip", { extractDir: "/shms" });
    await py.runPythonAsync(BOOT);
    handle = py.globals.get("shms_handle");
    post({ kind: "ready" });
    for (const r of queue.splice(0)) void answer(r);
  } catch (e) {
    post({ kind: "failed", error: String(e) });
  }
}
