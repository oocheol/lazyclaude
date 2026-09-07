#!/usr/bin/env python3
"""Dependency-contract tests for the deterministic offline suite.

The engine's runtime behavior is intentionally resilient when optional parser
dependencies are absent. The regression runner instead rejects that degraded
mode before tests whose expected output relies on real profile data or CSS
selector matching are executed.
"""
from __future__ import annotations

import contextlib
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))

from engine import waf_detector  # noqa: E402
from engine import validators  # noqa: E402
from engine.tests import run_offline  # noqa: E402


class _Resp:
    status_code = 200
    text = "<html><body><main id='content'>" + ("x" * 5000) + "</main></body></html>"
    headers = {"Content-Type": "text/html"}
    cookies = {}


def t_runner_rejects_missing_dependencies_before_tests():
    original = run_offline.importlib.util.find_spec
    try:
        run_offline.importlib.util.find_spec = lambda name: None if name == "yaml" else original(name)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            status = run_offline.check_test_dependencies()
    finally:
        run_offline.importlib.util.find_spec = original

    message = stderr.getvalue()
    assert status == 2, status
    assert "PyYAML" in message, message
    assert "from the repository root" in message, message
    assert "python -m pip install -r requirements-test.txt" in message, message
    print("  ✓ missing test dependency fails with an install command")


def t_runner_stops_before_launching_children_when_dependencies_are_missing():
    original_spec = run_offline.importlib.util.find_spec
    original_run = run_offline.subprocess.run
    launched = []
    try:
        run_offline.importlib.util.find_spec = lambda _name: None
        run_offline.subprocess.run = lambda *_args, **_kwargs: launched.append(True)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            status = run_offline.main()
    finally:
        run_offline.importlib.util.find_spec = original_spec
        run_offline.subprocess.run = original_run

    assert status == 2, status
    assert launched == [], launched
    print("  ✓ preflight exits before any offline child can launch")


def t_waf_profile_fallback_remains_available_at_runtime():
    original = waf_detector.yaml
    try:
        waf_detector.yaml = None
        profiles = waf_detector._load_profiles()
    finally:
        waf_detector.yaml = original

    assert profiles == waf_detector._DEFAULT_PROFILES, profiles
    assert waf_detector.last_load_error() == "PyYAML not installed — using in-code default profile"
    print("  ✓ production WAF fallback remains available without PyYAML")


def t_selector_fallback_remains_available_at_runtime():
    original = validators.BeautifulSoup
    try:
        validators.BeautifulSoup = None
        result = validators.validate(_Resp(), success_selectors=["#content"])
    finally:
        validators.BeautifulSoup = original

    assert result.verdict is validators.Verdict.UNKNOWN, result
    assert result.reasons == ["bs4_missing"], result.reasons
    print("  ✓ production selector fallback remains explicit without BeautifulSoup")


ALL = (
    ("runner_rejects_missing_dependencies_before_tests", t_runner_rejects_missing_dependencies_before_tests),
    ("runner_stops_before_launching_children_when_dependencies_are_missing",
     t_runner_stops_before_launching_children_when_dependencies_are_missing),
    ("waf_profile_fallback_remains_available_at_runtime", t_waf_profile_fallback_remains_available_at_runtime),
    ("selector_fallback_remains_available_at_runtime", t_selector_fallback_remains_available_at_runtime),
)


def main() -> int:
    passed = failed = 0
    for name, test in ALL:
        try:
            print(f"[{name}]")
            test()
            passed += 1
        except AssertionError as error:
            failed += 1
            print(f"  ✗ FAIL: {error}")
        except Exception as error:
            failed += 1
            print(f"  ✗ ERROR: {type(error).__name__}: {error}")
    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
