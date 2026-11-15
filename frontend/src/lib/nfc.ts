/**
 * Bridge between the phone's card reader and the web UI.
 *
 * The Android app reads cards natively (WebView has no Web NFC) and hands each one to
 * the page with `window.SHMS_onNfcTag("<card id>")`. It also exposes
 * `window.SHMSNative.nfcState()` returning "ready" | "off" | "none".
 * In a normal browser neither exists, so the page offers manual sign-in and a simulator.
 */
declare global {
  interface Window {
    SHMSNative?: { nfcState?: () => string };
    SHMS_onNfcTag?: (id: string) => void;
  }
}

export type ReaderState = "ready" | "off" | "none";

export function readerState(): ReaderState {
  try {
    const s = window.SHMSNative?.nfcState?.();
    return s === "ready" || s === "off" ? s : "none";
  } catch {
    return "none";
  }
}

const EVENT = "shms-nfc";
const PENDING_MS = 5000;
let pending: { id: string; at: number } | null = null;

/** Keep a tap for the next listener (used when a page hands the tap over to the login). */
export function keepForLogin(id: string) {
  pending = { id, at: Date.now() };
}

/** Deliver a card ID to whoever is listening. */
export function deliverTag(id: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }));
}

// Install the global early, and keep a tap that arrives before any page listens.
if (typeof window !== "undefined" && !window.SHMS_onNfcTag) {
  window.SHMS_onNfcTag = (id: string) => {
    keepForLogin(id);
    deliverTag(id);
  };
}

/** Listen for card taps. A tap from the last few seconds that nobody handled is delivered too. */
export function onCardTap(cb: (id: string) => void): () => void {
  const handler = (e: Event) => {
    pending = null;
    cb((e as CustomEvent<string>).detail);
  };
  window.addEventListener(EVENT, handler);
  if (pending && Date.now() - pending.at < PENDING_MS) {
    const id = pending.id;
    pending = null;
    setTimeout(() => cb(id), 0);
  } else {
    pending = null;
  }
  return () => window.removeEventListener(EVENT, handler);
}
