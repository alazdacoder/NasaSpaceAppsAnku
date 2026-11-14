"""English / Turkish responses.

Text that people read is stored twice: `key` (English) and `key_tr` (Turkish), in the
config and in what the engine produces. Each request picks one language (header
`X-Lang: tr`, or `?lang=tr`), and every JSON response is localized on the way out:
`key` takes the value of `key_tr` when Turkish is asked for, and the `_tr` twins are
dropped. The frontend's own labels have their own dictionary.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any
from urllib.parse import parse_qs

from fastapi.responses import JSONResponse

SUPPORTED = ("en", "tr")
LANG: ContextVar[str] = ContextVar("lang", default="en")


def localize(obj: Any, lang: str) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(k, str) and k.endswith("_tr"):
                continue
            if lang != "en" and isinstance(k, str):
                tv = obj.get(f"{k}_{lang}")
                if tv is not None:
                    out[k] = localize(tv, lang)
                    continue
            out[k] = localize(v, lang)
        return out
    if isinstance(obj, (list, tuple)):
        return [localize(x, lang) for x in obj]
    return obj


def pick(lang: str | None) -> str:
    lang = (lang or "").lower()[:2]
    return lang if lang in SUPPORTED else "en"


def tr(en: str, tr_text: str) -> str:
    """Inline choice for text built in route code."""
    return tr_text if LANG.get() == "tr" else en


class LocalizedJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return super().render(localize(content, LANG.get()))


class LangMiddleware:
    """Pure ASGI middleware: sets the request language from X-Lang or ?lang=."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        lang = None
        for k, v in scope.get("headers", []):
            if k == b"x-lang":
                lang = v.decode("latin-1")
                break
        if lang is None and scope.get("query_string"):
            q = parse_qs(scope["query_string"].decode("latin-1"))
            lang = (q.get("lang") or [None])[0]
        token = LANG.set(pick(lang))
        try:
            await self.app(scope, receive, send)
        finally:
            LANG.reset(token)
