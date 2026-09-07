"""Per-host curl_cffi Session pool + root warmup + browser→curl cookie bridge.

Why (multi-AI review 2026-06-21):
  * v1 issued a brand-new `curl_cffi.requests.get()` per attempt, so cookies
    set by a WAF (e.g. an Akamai `_abck` sensor or a CF `cf_clearance`) and
    the warm TLS/connection were thrown away between attempts and between
    pages of the same host. That caps both success rate (sensor cookies never
    mature) and throughput (handshake per request).
  * A browser fallback that punches through a JS challenge produces exactly the
    cookies + User-Agent a plain HTTP client needs — but v1 discarded them
    (`_FakeResp` kept only HTML). The bridge here lets one expensive browser
    pass convert into cheap curl_cffi throughput (the FlareSolverr pattern).

No-Site-Name Rule: keys are hashed hosts; no site names are stored or branched.
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import urlsplit


_SENSITIVE_REDIRECT_HEADERS = frozenset({
    "authorization", "cookie", "proxy-authorization", "referer",
})


def _host_of(url: str) -> str:
    return (urlsplit(url).hostname or "unknown").lower()


def _root_of(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}/"


def _origin_of(url: str) -> tuple[str, str, int]:
    p = urlsplit(url)
    return (p.scheme.lower(), (p.hostname or "").lower(),
            p.port or (443 if p.scheme.lower() == "https" else 80))


def _cookie_domain_matches(host: str, domain: str) -> bool:
    if not isinstance(host, str) or not isinstance(domain, str):
        return False
    host = host.lower().rstrip(".")
    domain = domain.lower().lstrip(".").rstrip(".")
    return bool(domain) and (host == domain or host.endswith("." + domain))


@dataclass
class _Entry:
    session: Any
    warmed: bool = False
    injected_ua: Optional[str] = None
    requests_made: int = 0
    lock: Any = field(default_factory=threading.Lock, repr=False)


@dataclass
class SessionPool:
    """Thread-safe pool of curl_cffi Sessions keyed by (host, impersonate)."""
    _entries: dict = field(default_factory=dict)
    _lock: Any = field(default_factory=threading.Lock)

    def _key(self, host: str, impersonate: str) -> tuple:
        return (host, impersonate)

    def get(self, host: str, impersonate: str) -> Optional[_Entry]:
        """Return (creating if needed) the pool entry, or None if curl_cffi
        is unavailable."""
        key = self._key(host, impersonate)
        with self._lock:
            ent = self._entries.get(key)
            if ent is not None:
                return ent
            try:
                from curl_cffi import requests as cffi_requests
            except ImportError:
                return None
            try:
                sess = cffi_requests.Session(impersonate=impersonate)
            except Exception:
                # Some impersonate names need a newer curl_cffi; let caller
                # fall back to a one-shot get by returning None.
                return None
            ent = _Entry(session=sess)
            self._entries[key] = ent
            return ent

    def warmup(self, host: str, impersonate: str, root_url: str, timeout: int = 15) -> bool:
        """Hit the site root once per (host, impersonate) so a WAF sensor can
        set a resolved session cookie before the real (deep) request. Idempotent.

        The warmup uses the same per-hop SSRF guard as a normal request; it
        must never delegate redirect following to curl_cffi.
        """
        ent = self.get(host, impersonate)
        if ent is None:
            return False
        with ent.lock:
            if ent.warmed:
                return False
            ent.warmed = True  # reserve before I/O so concurrent calls skip it
        resp, err = self.request(
            root_url,
            impersonate=impersonate,
            timeout=timeout,
        )
        if err is not None or resp is None:
            return False
        return True

    def inject_cookies(self, host: str, impersonate: str,
                       cookies: list[dict], user_agent: Optional[str] = None) -> bool:
        """Seed a session with cookies harvested by a real browser. Subsequent
        requests on this (host, impersonate) reuse the browser-cleared state."""
        ent = self.get(host, impersonate)
        if ent is None:
            return False
        ok = False
        with ent.lock:
            for c in cookies or []:
                if not isinstance(c, dict):
                    continue
                name = c.get("name")
                value = c.get("value")
                domain = c.get("domain") or host
                if not name or value is None or not _cookie_domain_matches(host, domain):
                    continue
                try:
                    ent.session.cookies.set(
                        name,
                        value,
                        domain=domain,
                        path=c.get("path") or "/",
                    )
                    ok = True
                except Exception:
                    # A domain-less retry would turn a rejected browser cookie
                    # into a broadly-scoped session cookie.  Skip it instead.
                    continue
            if user_agent:
                ent.injected_ua = user_agent
        return ok

    def request(self, url: str, *, impersonate: str, referer: str = "",
                timeout: int = 25, extra_headers: Optional[dict] = None,
                allow_private: Optional[bool] = None,
                max_redirects: Optional[int] = None) -> tuple[Any, Optional[str]]:
        """GET via the pooled session (cookie + connection reuse), with an SSRF
        guard: the initial URL and EVERY redirect hop are validated against the
        private/loopback/link-local/metadata block-list before being fetched.
        Falls back to a one-shot get if no session could be created."""
        from . import safety
        if allow_private is None:
            allow_private = safety.allow_private_default()
        if max_redirects is None:
            max_redirects = safety.DEFAULT_MAX_REDIRECTS

        ok, reason = safety.classify_url(url, allow_private)
        if not ok:
            return None, f"ssrf_blocked:{reason}"

        host = _host_of(url)
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        }
        if referer:
            headers["Referer"] = referer
        if extra_headers:
            headers.update(extra_headers)

        original_origin = _origin_of(url)
        sensitive_allowed = True

        def _headers_for(u: str) -> dict:
            nonlocal sensitive_allowed
            if _origin_of(u) != original_origin:
                # Once a redirect crosses origins, do not restore credentials
                # even if a later hop returns to the original origin.
                sensitive_allowed = False
            if sensitive_allowed:
                return headers
            return {k: v for k, v in headers.items()
                    if k.lower() not in _SENSITIVE_REDIRECT_HEADERS}

        ent = self.get(host, impersonate)
        if ent is None:
            try:
                from curl_cffi import requests as cffi_requests
            except ImportError:
                return None, "curl_cffi not installed"
            def _do_get(u):
                return cffi_requests.get(u, impersonate=impersonate, headers=_headers_for(u),
                                         timeout=timeout, allow_redirects=False)
            return self._fetch_following(_do_get, url, allow_private, max_redirects, None)

        with ent.lock:
            injected_ua = ent.injected_ua
        if injected_ua:
            headers.setdefault("User-Agent", injected_ua)
        def _do_get(u):
            return ent.session.get(u, headers=_headers_for(u), timeout=timeout, allow_redirects=False)
        return self._fetch_following(_do_get, url, allow_private, max_redirects, ent)

    @staticmethod
    def _fetch_following(do_get, url: str, allow_private: bool, max_redirects: int,
                         ent) -> tuple[Any, Optional[str]]:
        """Manually follow redirects so each hop is SSRF-validated (curl_cffi's
        own allow_redirects=True would skip the per-hop check)."""
        from . import safety
        cur = url
        for hop in range(max_redirects + 1):
            # Revalidate immediately before every call.  This still cannot pin
            # curl's DNS result, but avoids trusting a URL merely because an
            # earlier caller (or redirect branch) classified it.
            ok, reason = safety.classify_url(cur, allow_private)
            if not ok:
                prefix = "ssrf_blocked" if hop == 0 else "ssrf_redirect_blocked"
                return None, f"{prefix}:{reason}"
            try:
                if ent is None:
                    resp = do_get(cur)
                else:
                    # curl_cffi Session/cookie state is shared per entry; keep
                    # each request and its counter update atomic.
                    with ent.lock:
                        resp = do_get(cur)
                        ent.requests_made += 1
            except Exception as e:
                return None, f"{type(e).__name__}:{str(e)[:200]}"
            if safety.is_redirect(resp):
                loc = safety.location_of(resp)
                if not loc:
                    return resp, None     # redirect w/o Location → return as-is
                try:
                    nxt = safety.resolve_redirect(cur, loc)
                except (TypeError, ValueError) as e:
                    return None, f"invalid_redirect:{type(e).__name__}"
                ok, reason = safety.classify_url(nxt, allow_private)
                if not ok:
                    return None, f"ssrf_redirect_blocked:{reason}"
                cur = nxt
                continue
            return resp, None
        return None, "too_many_redirects"

    def stats(self) -> dict:
        with self._lock:
            entries = list(self._entries.values())
        # Do not hold the pool lock while waiting on active requests.
        snapshots = []
        for e in entries:
            with e.lock:
                snapshots.append((e.warmed, e.requests_made))
        return {
            "sessions": len(entries),
            "warmed": sum(1 for warmed, _ in snapshots if warmed),
            "requests": sum(requests for _, requests in snapshots),
        }

    def reset(self) -> None:
        with self._lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for e in entries:
            with e.lock:
                try:
                    e.session.close()
                except Exception:
                    pass


# Process-wide pool. Disable via INSANE_NO_SESSION_POOL=1 (one-shot mode).
POOL = SessionPool()


def pool_enabled() -> bool:
    return os.environ.get("INSANE_NO_SESSION_POOL", "") not in ("1", "true", "yes")
