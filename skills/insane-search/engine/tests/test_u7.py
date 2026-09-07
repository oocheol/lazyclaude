#!/usr/bin/env python3
"""U7 tests — SSRF / redirect guard. Offline & deterministic.

Run:  python3 engine/tests/test_u7.py
"""
from __future__ import annotations

import os
import socket
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))

from engine import phase0, safety, transport       # noqa: E402
from engine.safety import classify_url             # noqa: E402
from engine.transport import SessionPool, _Entry   # noqa: E402


def t_classify_blocks_internal():
    blocked = [
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",   # cloud metadata
        "http://10.0.0.1/",
        "http://192.168.1.1/admin",
        "http://172.16.0.1/",
        "http://100.64.0.1/",                        # carrier-grade NAT
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",                 # IPv4-mapped loopback
        "http://224.0.0.1/",                         # IPv4 multicast
        "http://[ff02::1]/",                         # IPv6 multicast
        "http://0.0.0.0/",
        "ftp://example.com/",                          # scheme
        "file:///etc/passwd",                          # scheme
    ]
    for u in blocked:
        ok, reason = classify_url(u, allow_private=False)
        assert not ok, f"should block {u} (got ok, reason={reason})"
    print(f"  ✓ blocks {len(blocked)} internal/metadata/scheme targets")


def t_malformed_and_dns_failure_fail_closed():
    for u in ["http://example.com:not-a-port/", "http://example.com:70000/",
              "http://example.com\\@127.0.0.1/"]:
        ok, reason = classify_url(u, allow_private=True)
        assert not ok, (u, reason)

    original = safety.socket.getaddrinfo
    try:
        safety.socket.getaddrinfo = lambda *_a, **_k: (_ for _ in ()).throw(
            socket.gaierror("offline"))
        ok, reason = classify_url("https://unresolved.invalid/")
        assert not ok and reason.startswith("resolve_failed:"), reason
    finally:
        safety.socket.getaddrinfo = original
    print("  ✓ malformed ports/chars and DNS failures fail closed")


def t_dns_answer_checks_internal_ranges():
    original = safety.socket.getaddrinfo
    try:
        for answer in ("100.64.12.3", "127.0.0.1", "not-an-ip"):
            safety.socket.getaddrinfo = lambda *_a, _answer=answer, **_k: [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (_answer, 443))
            ]
            ok, reason = classify_url("https://public-looking.test/")
            assert not ok and reason.startswith("resolves_internal:"), (answer, reason)
    finally:
        safety.socket.getaddrinfo = original
    print("  ✓ DNS answers in loopback/CGNAT/unparseable space are blocked")


def t_classify_allows_public():
    for u in ["https://1.1.1.1/", "http://8.8.8.8/"]:   # public IP literals (no DNS)
        ok, reason = classify_url(u, allow_private=False)
        assert ok, f"should allow public {u} ({reason})"
    print("  ✓ allows public IP literals")


def t_allow_private_optin():
    ok, _ = classify_url("http://127.0.0.1:8080/", allow_private=True)
    assert ok, "allow_private=True must permit loopback"
    print("  ✓ allow_private=True opt-in permits loopback (local testing)")


def t_request_blocks_localhost_by_default():
    p = SessionPool()
    resp, err = p.request("http://127.0.0.1:9/", impersonate="chrome")  # no fetch happens
    assert resp is None and err and err.startswith("ssrf_blocked"), (resp, err)
    print(f"  ✓ POOL.request blocks loopback pre-fetch: {err}")


class _FakeResp:
    def __init__(self, status, headers=None):
        self.status_code = status
        self.headers = headers or {}
        self.text = "ok"


def t_redirect_to_metadata_blocked():
    calls = {"n": 0}
    def do_get(u):
        calls["n"] += 1
        if calls["n"] == 1:
            return _FakeResp(302, {"Location": "http://169.254.169.254/latest/meta-data/"})
        return _FakeResp(200)
    resp, err = SessionPool._fetch_following(do_get, "https://1.1.1.1/", False, 5, None)
    assert resp is None and err and err.startswith("ssrf_redirect_blocked"), (resp, err)
    print(f"  ✓ redirect into metadata IP blocked: {err}")


def t_safe_redirect_followed():
    hops = {"n": 0}
    def do_get(u):
        hops["n"] += 1
        if hops["n"] == 1:
            return _FakeResp(302, {"Location": "http://1.1.1.1/landing"})  # public
        return _FakeResp(200)
    resp, err = SessionPool._fetch_following(do_get, "https://8.8.8.8/start", False, 5, None)
    assert err is None and resp is not None and resp.status_code == 200, (resp, err)
    assert hops["n"] == 2, hops
    print(f"  ✓ safe redirect to public IP followed ({hops['n']} hops → 200)")


def t_too_many_redirects():
    def do_get(u):
        return _FakeResp(302, {"Location": "http://1.1.1.1/loop"})
    resp, err = SessionPool._fetch_following(do_get, "http://1.1.1.1/loop", False, 3, None)
    assert resp is None and err == "too_many_redirects", (resp, err)
    print("  ✓ redirect loop capped (too_many_redirects)")


def t_malformed_redirect_is_reported():
    def do_get(_u):
        return _FakeResp(302, {"Location": b"https://1.1.1.1/bytes"})
    resp, err = SessionPool._fetch_following(
        do_get, "https://1.1.1.1/start", False, 3, None)
    assert resp is None and err == "invalid_redirect:TypeError", (resp, err)
    print("  ✓ malformed redirect location returns a bounded error")


class _FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)


def _pool_with(session, host="1.1.1.1", impersonate="chrome"):
    p = SessionPool()
    p._entries[(host, impersonate)] = _Entry(session=session)
    return p


def t_warmup_uses_guarded_redirects():
    session = _FakeSession([
        _FakeResp(302, {"Location": "http://169.254.169.254/latest/meta-data/"}),
    ])
    p = _pool_with(session)
    ok = p.warmup("1.1.1.1", "chrome", "https://1.1.1.1/", timeout=3)
    assert not ok
    assert len(session.calls) == 1, session.calls
    assert session.calls[0][1]["allow_redirects"] is False
    assert p.stats() == {"sessions": 1, "warmed": 1, "requests": 1}
    print("  ✓ warmup uses guarded, manual redirect handling")


def t_cross_origin_redirect_strips_sensitive_headers():
    session = _FakeSession([
        _FakeResp(302, {"Location": "https://8.8.8.8/next"}),
        _FakeResp(200),
    ])
    p = _pool_with(session)
    resp, err = p.request(
        "https://1.1.1.1/start",
        impersonate="chrome",
        extra_headers={
            "Authorization": "Bearer secret",
            "Cookie": "secret=1",
            "Proxy-Authorization": "Basic secret",
            "Referer": "https://1.1.1.1/private?token=secret",
            "X-Keep": "yes",
        },
    )
    assert err is None and resp.status_code == 200, err
    first = session.calls[0][1]["headers"]
    second = session.calls[1][1]["headers"]
    assert first["Authorization"] == "Bearer secret"
    assert not any(k.lower() in transport._SENSITIVE_REDIRECT_HEADERS for k in second), second
    assert second["X-Keep"] == "yes"
    assert all(call[1]["allow_redirects"] is False for call in session.calls)
    print("  ✓ cross-origin redirect strips explicit credentials")


def t_same_origin_redirect_keeps_sensitive_headers():
    session = _FakeSession([
        _FakeResp(302, {"Location": "/next"}),
        _FakeResp(200),
    ])
    p = _pool_with(session)
    resp, err = p.request(
        "https://1.1.1.1/start", impersonate="chrome",
        extra_headers={"Authorization": "Bearer same-origin"},
    )
    assert err is None and resp.status_code == 200, err
    assert session.calls[1][1]["headers"]["Authorization"] == "Bearer same-origin"
    print("  ✓ same-origin redirect retains explicit credentials")


class _FakeCookies:
    def __init__(self):
        self.calls = []

    def set(self, name, value, **kwargs):
        self.calls.append((name, value, kwargs))
        if name == "reject":
            raise ValueError("reject")


def t_cookie_injection_scopes_domain_and_path():
    session = type("CookieSession", (), {})()
    session.cookies = _FakeCookies()
    p = _pool_with(session, host="www.example.com")
    ok = p.inject_cookies("www.example.com", "chrome", [
        {"name": "good", "value": "1", "domain": ".example.com", "path": "/account"},
        {"name": "foreign", "value": "2", "domain": "attacker.test", "path": "/"},
        {"name": "reject", "value": "3", "domain": "www.example.com", "path": "/"},
    ])
    assert ok
    names = [c[0] for c in session.cookies.calls]
    assert names == ["good", "reject"], names
    assert session.cookies.calls[0][2] == {"domain": ".example.com", "path": "/account"}
    assert names.count("reject") == 1, "must not retry as a domain-less cookie"
    print("  ✓ cookie injection preserves path and rejects unsafe fallback/domain")


def t_phase0_host_boundaries_and_guarded_transport():
    assert phase0._detect("https://old.reddit.com/r/python") == "reddit"
    assert phase0._detect("https://reddit.com.attacker.test/") is None
    assert phase0._detect("https://notyoutube.com/watch?v=x") is None
    assert phase0._detect("https://m.youtube.com/watch?v=x") == "youtube"

    sentinel = _FakeResp(200)
    calls = []
    fake_pool = type("FakePool", (), {"request": lambda _self, *a, **k:
                     (calls.append((a, k)) or (sentinel, None))})()
    original = transport.POOL
    try:
        transport.POOL = fake_pool
        assert phase0._cffi_get("https://1.1.1.1/") is sentinel
    finally:
        transport.POOL = original
    assert calls and calls[0][1]["impersonate"] == "safari"
    print("  ✓ Phase-0 exact host boundaries + guarded common transport")


def t_phase0_external_executor_requires_safe_initial_url():
    original_dns = safety.socket.getaddrinfo
    original_run = phase0.subprocess.run
    ran = {"value": False}
    try:
        safety.socket.getaddrinfo = lambda *_a, **_k: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("100.64.0.8", 443))
        ]
        phase0.subprocess.run = lambda *_a, **_k: ran.update(value=True)
        result = phase0.route("https://youtube.com/watch?v=test")
    finally:
        safety.socket.getaddrinfo = original_dns
        phase0.subprocess.run = original_run
    assert result is not None and not result["ok"]
    assert result["attempts"][0]["route"] == "safety", result
    assert ran["value"] is False, "external executor must not run after unsafe preflight"
    print("  ✓ Phase-0 external executor requires a safe initial URL")


ALL = [
    ("classify_blocks_internal", t_classify_blocks_internal),
    ("malformed_and_dns_failure_fail_closed", t_malformed_and_dns_failure_fail_closed),
    ("dns_answer_checks_internal_ranges", t_dns_answer_checks_internal_ranges),
    ("classify_allows_public", t_classify_allows_public),
    ("allow_private_optin", t_allow_private_optin),
    ("request_blocks_localhost_by_default", t_request_blocks_localhost_by_default),
    ("redirect_to_metadata_blocked", t_redirect_to_metadata_blocked),
    ("safe_redirect_followed", t_safe_redirect_followed),
    ("too_many_redirects", t_too_many_redirects),
    ("malformed_redirect_is_reported", t_malformed_redirect_is_reported),
    ("warmup_uses_guarded_redirects", t_warmup_uses_guarded_redirects),
    ("cross_origin_redirect_strips_sensitive_headers", t_cross_origin_redirect_strips_sensitive_headers),
    ("same_origin_redirect_keeps_sensitive_headers", t_same_origin_redirect_keeps_sensitive_headers),
    ("cookie_injection_scopes_domain_and_path", t_cookie_injection_scopes_domain_and_path),
    ("phase0_host_boundaries_and_guarded_transport", t_phase0_host_boundaries_and_guarded_transport),
    ("phase0_external_executor_requires_safe_initial_url", t_phase0_external_executor_requires_safe_initial_url),
]


def main() -> int:
    p = f = 0
    for name, fn in ALL:
        try:
            print(f"[{name}]")
            fn()
            p += 1
        except AssertionError as e:
            f += 1
            print(f"  ✗ FAIL: {e}")
        except Exception as e:
            f += 1
            print(f"  ✗ ERROR: {type(e).__name__}: {e}")
    print(f"\n{p} passed, {f} failed")
    return 0 if f == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
