#!/usr/bin/env python3
"""Точка входа песочницы компиляции: читает JSON из stdin, компилирует скетч arduino-cli, печатает JSON в stdout.

Вход:  {"fqbn": "arduino:avr:uno", "code": "...", "timeout": 120}
Выход: {"ok": bool, "log": str, "ms": int, "files": {"sketch.ino.hex": "<base64>"}, "timeout": bool}
Контейнер запускается без сети, с read-only корнем, лимитами памяти/процессов и без привилегий.
"""
import base64
import glob
import json
import os
import subprocess
import sys
import tempfile
import time

MAX_LOG = 20_000
MAX_FILE = 2_000_000


def main() -> None:
    req = json.load(sys.stdin)
    fqbn, code = str(req["fqbn"]), str(req["code"])
    timeout = min(int(req.get("timeout", 120)), 300)

    work = tempfile.mkdtemp(prefix="cm-", dir="/tmp")
    sketch = os.path.join(work, "sketch")
    os.makedirs(sketch)
    with open(os.path.join(sketch, "sketch.ino"), "w", encoding="utf-8") as f:
        f.write(code)
    out = os.path.join(work, "out")

    cmd = [
        "arduino-cli", "compile",
        "--fqbn", fqbn,
        "--output-dir", out,
        "--build-path", os.path.join(work, "build"),
        "--warnings", "default",
        "--no-color",
        sketch,
    ]
    started = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "log": "Compilation timed out", "ms": int((time.time() - started) * 1000), "files": {}, "timeout": True}))
        return

    log = (p.stdout + p.stderr)[-MAX_LOG:]
    files = {}
    if p.returncode == 0:
        # прошивка без загрузчика (.hex) или образ для RP2040/ESP32 (.uf2 / .bin)
        for pattern in ("*.hex", "*.uf2", "*.bin"):
            for path in sorted(glob.glob(os.path.join(out, pattern))):
                name = os.path.basename(path)
                if "bootloader" in name or os.path.getsize(path) > MAX_FILE:
                    continue
                with open(path, "rb") as f:
                    files[name] = base64.b64encode(f.read()).decode()
    print(json.dumps({"ok": p.returncode == 0, "log": log, "ms": int((time.time() - started) * 1000), "files": files, "timeout": False}))


if __name__ == "__main__":
    main()
