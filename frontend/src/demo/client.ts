/**
 * Web demo client. Built with VITE_DEMO=1 (the GitHub Pages site), the app talks to the
 * SHMS backend running in a worker (see pyWorker.ts) instead of a server.
 * In the normal builds (local server, Windows exe, Android app) none of this runs.
 */
export const DEMO = import.meta.env.VITE_DEMO === "1";

export type BootStep = "runtime" | "packages" | "mission" | "ready" | "failed";

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (r: { status: number; type: string; body: string }) => void>();
const listeners = new Set<(s: BootStep, error?: string) => void>();
let step: BootStep = "runtime";
let failure: string | undefined;

function setStep(s: BootStep, error?: string) {
  step = s;
  failure = error;
  listeners.forEach((l) => l(s, error));
}

/** Start the in-browser backend (once). */
export function bootDemo() {
  if (worker) return;
  worker = new Worker(new URL("./pyWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.kind === "progress") setStep(m.step);
    else if (m.kind === "ready") setStep("ready");
    else if (m.kind === "failed") setStep("failed", m.error);
    else if (typeof m.id === "number") {
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  };
  worker.onerror = (e) => setStep("failed", e.message);
  worker.postMessage({ kind: "boot", bundle: `${import.meta.env.BASE_URL}demo/backend.zip` });
}

export function onBoot(cb: (s: BootStep, error?: string) => void): () => void {
  listeners.add(cb);
  cb(step, failure);
  return () => listeners.delete(cb);
}

/** fetch() for /api paths, answered by the worker. */
export function demoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  bootDemo();
  const id = nextId++;
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
  return new Promise((resolve) => {
    waiting.set(id, (r) => resolve(new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: { "Content-Type": r.type } })));
    worker!.postMessage({
      kind: "req",
      id,
      method: (init.method ?? "GET").toUpperCase(),
      url: path,
      headers,
      body: typeof init.body === "string" ? init.body : null,
    });
  });
}
