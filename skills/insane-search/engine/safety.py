"""SSRF / redirect safety guard for an agent-facing fetcher.

curl_cffi follows redirects but does NOT validate the destination (confirmed
against the official docs: there is no built-in private-IP/safe-redirect
option). Since this engine fetches attacker-influenced URLs and follows their
redirects, a hostile page could redirect to loopback, RFC-1918, link-local, or
the cloud metadata endpoint (169.254.169.254) to exfiltrate internal data.

This module provides a URL classifier and a redirect resolver.  Hostname
classification depends on DNS and therefore is intentionally fail-closed.
Default-deny for private/internal targets; opt in with allow_private=True
(env INSANE_ALLOW_PRIVATE=1) for local testing.

Important limit: resolving here and connecting later does not pin the resolved
address.  It narrows the SSRF surface, but cannot by itself prevent DNS
rebinding between the check and curl's connection.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urljoin, urlsplit

ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_MAX_REDIRECTS = 10


def allow_private_default() -> bool:
    return os.environ.get("INSANE_ALLOW_PRIVATE", "").lower() in ("1", "true", "yes")


def _ip_blocked(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        # Resolver output is data from outside this module.  If it is not an
        # address we can classify, fail closed rather than treating it public.
        return True
    # Permit only globally-routable unicast addresses.  In particular,
    # 100.64.0.0/10 (carrier-grade NAT/shared address space) is neither
    # ``private`` nor ``reserved`` in Python's ipaddress module, but it is not
    # globally reachable and must not be usable as an SSRF target.
    return (not ip.is_global or ip.is_private or ip.is_loopback
            or ip.is_link_local or ip.is_reserved or ip.is_multicast
            or ip.is_unspecified)


def classify_url(url: str, allow_private: bool = False) -> tuple[bool, str]:
    """(is_safe, reason). Blocks non-http(s) schemes and hosts that are — or
    DNS-resolve to — private/loopback/link-local/reserved/metadata addresses."""
    try:
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in url) or "\\" in url:
            return False, "invalid_char"
        p = urlsplit(url)
    except Exception as e:
        return False, f"parse_error:{e}"
    if p.scheme not in ALLOWED_SCHEMES:
        return False, f"scheme:{p.scheme or 'none'}"
    host = p.hostname
    if not host:
        return False, "no_host"

    # Accessing SplitResult.port performs validation and raises for malformed
    # or out-of-range values.  Do this even for the local-testing opt-in so an
    # ambiguous URL is never handed to a different parser downstream.
    try:
        port = p.port or (443 if p.scheme == "https" else 80)
    except ValueError as e:
        return False, f"invalid_port:{e}"
    if allow_private:
        return True, "allow_private"

    # IP literal host → check directly (covers cloud metadata, loopback, …)  # NOTE-BIAS-OK
    try:
        ipaddress.ip_address(host)
        return (False, f"ip_blocked:{host}") if _ip_blocked(host) else (True, "public_ip")
    except ValueError:
        pass

    # Hostname → resolve and check every returned A/AAAA address.  This is
    # a preflight check, not DNS pinning; see the module-level limit above.
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        ips = {info[4][0] for info in infos}
    except (socket.gaierror, OSError, UnicodeError, ValueError) as e:
        return False, f"resolve_failed:{type(e).__name__}"
    if not ips:
        return False, "resolve_failed:no_addresses"
    for ip in ips:
        if _ip_blocked(str(ip)):
            return False, f"resolves_internal:{host}->{ip}"
    return True, "public"


def location_of(resp) -> str | None:
    """Case-insensitive Location header from a curl_cffi/requests response."""
    try:
        headers = {k.lower(): v for k, v in dict(getattr(resp, "headers", {}) or {}).items()}
        return headers.get("location")
    except Exception:
        return None


def is_redirect(resp) -> bool:
    try:
        return int(getattr(resp, "status_code", 0) or 0) in (301, 302, 303, 307, 308)
    except Exception:
        return False


def resolve_redirect(base_url: str, location: str) -> str:
    return urljoin(base_url, location)
