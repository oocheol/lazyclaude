#!/usr/bin/env python3
"""Run every deterministic insane-search engine regression script.

The existing tests are custom executable scripts (their functions intentionally
do not use unittest/pytest discovery).  Each module runs through offline_child,
which rejects DNS and socket connections.  Keep online integration scripts such
as test_smoke.py and test_u4.py out of this runner.
"""
from __future__ import annotations

import os
import subprocess
import sys


HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGE_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODULES = (
    "engine.tests.test_u1",
    "engine.tests.test_u5",
    "engine.tests.test_u7",
    "engine.bias_check",
)


def main() -> int:
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
