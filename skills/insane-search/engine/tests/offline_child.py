"""Execute one custom test module with network operations disabled."""
from __future__ import annotations

import runpy
import socket
import sys


def _blocked(*_args, **_kwargs):
    raise AssertionError("offline test attempted a network/DNS operation")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m engine.tests.offline_child MODULE")
        return 2
    module = sys.argv[1]
    socket.getaddrinfo = _blocked
    socket.create_connection = _blocked
    socket.socket.connect = _blocked
    socket.socket.connect_ex = _blocked
    sys.argv = [module]
    runpy.run_module(module, run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
