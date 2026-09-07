#!/usr/bin/env python3
"""Run every deterministic insane-search engine regression script.

The existing tests are custom executable scripts (their functions intentionally
do not use unittest/pytest discovery).  Each module runs through offline_child,
which rejects DNS and socket connections.  Keep online integration scripts such
as test_smoke.py and test_u4.py out of this runner.
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys


HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGE_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODULES = (
    "engine.tests.test_dependencies",
    "engine.tests.test_u1",
    "engine.tests.test_u5",
    "engine.tests.test_u7",
    "engine.bias_check",
)

# These packages remain optional at runtime: the engine preserves its
# degraded-mode fallbacks for source checkouts that do not install them. The
# regression suite, however, asserts behavior that needs the real YAML
# profiles and HTML selector parser, so it must refuse to run in degraded mode.
REQUIRED_TEST_DEPENDENCIES = {
    "yaml": "PyYAML",
    "bs4": "beautifulsoup4",
    "soupsieve": "soupsieve",
    "typing_extensions": "typing_extensions",
}


def missing_test_dependencies() -> list[str]:
    """Return test requirements unavailable to this interpreter."""
    return [
        package
        for module, package in REQUIRED_TEST_DEPENDENCIES.items()
        if importlib.util.find_spec(module) is None
    ]


def check_test_dependencies() -> int:
    """Fail before fallback-dependent tests can produce misleading results."""
    missing = missing_test_dependencies()
    if not missing:
        return 0
    print(
        "OFFLINE PRECONDITION FAIL: missing test dependencies: "
        + ", ".join(missing),
        file=sys.stderr,
    )
    print(
        "Install them from the repository root with: "
        "python -m pip install -r requirements-test.txt",
        file=sys.stderr,
    )
    return 2


def main() -> int:
    dependency_status = check_test_dependencies()
    if dependency_status:
        return dependency_status

    failed = []
    child_env = os.environ.copy()
    child_env["PYTHONIOENCODING"] = "utf-8"
    child_env["PYTHONUTF8"] = "1"
    for module in MODULES:
        print(f"\n=== {module} ===", flush=True)
        completed = subprocess.run(
            [sys.executable, "-m", "engine.tests.offline_child", module],
            cwd=PACKAGE_ROOT,
            check=False,
            env=child_env,
        )
        if completed.returncode:
            failed.append((module, completed.returncode))
    if failed:
        print(f"\nOFFLINE FAIL: {failed}")
        return 1
    print(f"\nOFFLINE PASS: {len(MODULES)} scripts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
