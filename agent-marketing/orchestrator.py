"""
Legacy entrypoint wrapper.

The active studio marketing orchestrator lives at:
    agent-marketing/agents/orchestrator.py

This wrapper exists to reduce confusion for anyone invoking the old
top-level path directly.
"""
from __future__ import annotations

import os
import subprocess
import sys


def main() -> int:
    script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agents", "orchestrator.py")
    result = subprocess.run([sys.executable, script_path, *sys.argv[1:]])
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
