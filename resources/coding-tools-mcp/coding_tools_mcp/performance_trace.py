from __future__ import annotations

import copy
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAX_RECENT = 100
MAX_IDLE_GAP_MS = 30 * 60 * 1000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class PerformanceTraceStore:
    """Small workspace-local performance ledger for MCP calls.

    The gap between the previous tool completion and the next tool start is an
    estimate of model/network wait time, not local execution time.
    """

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()
        self.state_dir = self.workspace / ".coding-tools"
        self.path = self.state_dir / "performance.json"
        self._lock = threading.RLock()
        self._last_finished_monotonic: float | None = None

    def record(
        self,
        *,
        tool: str,
        started_monotonic: float,
        finished_monotonic: float,
        request_bytes: int = 0,
        response_bytes: int = 0,
        ok: bool = True,
        cache_hit: bool = False,
        deduplicated: bool = False,
    ) -> dict[str, Any]:
        with self._lock:
            wait_before_ms = 0
            if self._last_finished_monotonic is not None:
                gap = max(0, int((started_monotonic - self._last_finished_monotonic) * 1000))
                if gap <= MAX_IDLE_GAP_MS:
                    wait_before_ms = gap
            self._last_finished_monotonic = finished_monotonic
            duration_ms = max(0, int((finished_monotonic - started_monotonic) * 1000))
            state = self._read()
            event = {
                "tool": tool,
                "started_at": utc_now(),
                "finished_at": utc_now(),
                "duration_ms": duration_ms,
                "wait_before_ms": wait_before_ms,
                "request_bytes": max(0, int(request_bytes)),
                "response_bytes": max(0, int(response_bytes)),
                "cache_hit": bool(cache_hit),
                "deduplicated": bool(deduplicated),
                "ok": bool(ok),
            }
            state["tool_calls"] += 1
            state["errors"] += 0 if ok else 1
            state["cache_hits"] += 1 if cache_hit else 0
            state["deduplicated_calls"] += 1 if deduplicated else 0
            state["local_execution_ms"] += duration_ms
            state["estimated_wait_ms"] += wait_before_ms
            state["request_bytes"] += event["request_bytes"]
            state["response_bytes"] += event["response_bytes"]
            state["last_finished_at"] = event["finished_at"]
            state["recent"] = (state.get("recent", []) + [event])[-MAX_RECENT:]
            self._write(state)
            return copy.deepcopy(state)

    def get(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._read())

    def clear(self) -> dict[str, Any]:
        with self._lock:
            self._last_finished_monotonic = None
            try:
                self.path.unlink(missing_ok=True)
            except OSError:
                pass
            return self._default()

    @staticmethod
    def _default() -> dict[str, Any]:
        return {
            "version": 1,
            "tool_calls": 0,
            "errors": 0,
            "cache_hits": 0,
            "deduplicated_calls": 0,
            "local_execution_ms": 0,
            "estimated_wait_ms": 0,
            "request_bytes": 0,
            "response_bytes": 0,
            "last_finished_at": None,
            "recent": [],
        }

    def _read(self) -> dict[str, Any]:
        state = self._default()
        try:
            parsed = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return state
        if isinstance(parsed, dict):
            state.update(parsed)
        if not isinstance(state.get("recent"), list):
            state["recent"] = []
        return state

    def _write(self, state: dict[str, Any]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f".{self.path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temp, self.path)
        finally:
            temp.unlink(missing_ok=True)
