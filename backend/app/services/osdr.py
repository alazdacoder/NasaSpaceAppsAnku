"""NASA OSDR (Open Science Data Repository) Biological Data API client.

Uses the documented query endpoint
  https://visualization.osdr.nasa.gov/biodata/api/v2/query/datasets/
with field filters (study.characteristics.organism=Homo sapiens) and extra columns
(study title, study description), format=json.records. On any failure the app falls
back to the last successful response, then to the copy shipped in config/.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from ..config import DATA_DIR, ROOT

API = "https://visualization.osdr.nasa.gov/biodata/api/v2/query/datasets/"
STUDY_URL = "https://osdr.nasa.gov/bio/repo/data/studies/{acc}"
FALLBACK = ROOT / "config" / "osdr_fallback.json"
CACHE = DATA_DIR / "osdr_cache.json"
CACHE_TTL_S = 6 * 3600

TOPICS = {
    "Kidney & urine": r"kidney|renal|urin|nephr|stone",
    "Bone & muscle": r"\bbone|osteo|skeletal|muscle|calcium|bed rest",
    "Exercise": r"exercise|countermeasure|treadmill|resistive",
    "Sleep & circadian": r"sleep|circadian|melatonin",
    "Cardiovascular": r"cardi|heart|vascular|huvec|endotheli",
    "Radiation": r"radiat|\bhze\b|proton|gamma|ionizing|cosmic|alpha.particle",
    "Astronaut / crew": r"astronaut|crew|twin|inspiration4|mars 520|spaceflight multi-omics",
}
PRIORITY = ["Astronaut / crew", "Kidney & urine", "Bone & muscle", "Exercise", "Sleep & circadian", "Cardiovascular", "Radiation"]


def query_url() -> str:
    params = [("study.characteristics.organism", "Homo sapiens")]
    url = API + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    return url + "&investigation.study.study%20title&investigation.study.study%20description&format=json.records"


def _normalize(rows: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for r in rows:
        acc = r.get("id.accession") or r.get("accession")
        if not acc or acc in seen:
            continue
        seen[acc] = {"accession": acc,
                     "title": r.get("investigation.study.study title") or r.get("title") or "",
                     "description": (r.get("investigation.study.study description") or r.get("description") or "")[:600]}
    return list(seen.values())


def _tag(studies: list[dict]) -> list[dict]:
    out = []
    for s in studies:
        text = f"{s['title']} {s['description']}"
        topics = [t for t, rx in TOPICS.items() if re.search(rx, text, re.I)]
        rank = min((PRIORITY.index(t) for t in topics), default=len(PRIORITY))
        out.append({**s, "topics": topics, "url": STUDY_URL.format(acc=s["accession"]), "_rank": rank})
    out.sort(key=lambda s: (s["_rank"], int(s["accession"].split("-")[1]) if s["accession"].split("-")[-1].isdigit() else 0))
    for s in out:
        s.pop("_rank")
    return out


def fetch_live(timeout: float = 15.0) -> list[dict]:
    req = urllib.request.Request(query_url(), headers={"User-Agent": "crew-health-hub-demo/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        rows = json.load(resp)
    if not isinstance(rows, list):
        raise ValueError("unexpected OSDR response")
    return _normalize(rows)


def related_studies(force_live: bool = False) -> dict:
    """Return tagged studies plus where they came from: live, cache or fallback."""
    if not force_live and CACHE.exists() and time.time() - CACHE.stat().st_mtime < CACHE_TTL_S:
        data = json.loads(CACHE.read_text())
        return {"origin": "cache", "fetched_at": data["fetched_at"], "query_url": query_url(),
                "studies": _tag(data["studies"]), "error": None}
    try:
        studies = fetch_live()
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps({"fetched_at": stamp, "studies": studies}))
        return {"origin": "live", "fetched_at": stamp, "query_url": query_url(), "studies": _tag(studies), "error": None}
    except Exception as exc:  # network down, API change, timeout: use cached copy
        src = CACHE if CACHE.exists() else FALLBACK
        data = json.loads(src.read_text())
        return {"origin": "cache" if src == CACHE else "fallback", "fetched_at": data.get("fetched_at"),
                "query_url": query_url(), "studies": _tag(_normalize(data["studies"])), "error": f"{type(exc).__name__}: {exc}"}
