/**
 * Phone status bar and navigation bar follow the page.
 *
 * In the Android app the system bars sit above and below the WebView. This samples the
 * colour at the page's top and bottom edges and hands it to the app
 * (window.SHMSNative.setBars), so the colour runs into the phone's curved corners instead
 * of stopping at two bands. An element can name its edge colour with data-bar-top /
 * data-bar-bottom (used where the background is a gradient or an image).
 * In a normal browser there is no bridge and this does nothing.
 */
function solidBg(el: Element | null, edge: "top" | "bottom"): string | null {
  for (let e: Element | null = el; e !== null; e = (e as Element).parentElement) {
    const named = (e as HTMLElement).dataset?.[edge === "top" ? "barTop" : "barBottom"];
    if (named) return named;
    const c = getComputedStyle(e).backgroundColor;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) continue;
    const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
    if (parseFloat(a) < 0.5) continue;
    return "#" + [r, g, b].map((v) => Math.round(parseFloat(v)).toString(16).padStart(2, "0")).join("");
  }
  return null;
}

/** The page ground (--ink-950, stored as "R G B") as #rrggbb. */
function groundHex(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--ink-950").trim().split(/\s+/);
  return "#" + v.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

let last = "";

function sync() {
  const set = window.SHMSNative?.setBars;
  if (!set) return;
  const x = Math.round(window.innerWidth / 2);
  const top = solidBg(document.elementFromPoint(x, 1), "top") ?? groundHex();
  const bottom = solidBg(document.elementFromPoint(x, window.innerHeight - 1), "bottom") ?? groundHex();
  const key = `${top}|${bottom}`;
  if (key === last) return;
  last = key;
  try { set(top, bottom); } catch { /* app without the bridge */ }
}

/** Start following the page (route changes, theme switches, scrolling). */
export function startSystemBars() {
  if (typeof window === "undefined" || !window.SHMSNative?.setBars) return;
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  };
  window.addEventListener("scroll", later, { passive: true });
  window.addEventListener("resize", later);
  new MutationObserver(later).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  sync();
}
