from __future__ import annotations

import copy
import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STATE_VERSION = 1
MAX_EVENTS = 100
MAX_RESULTS = 20
MAX_FILES = 500
MAX_TEXT = 16_000
STALE_ACTIVE_SECONDS = 90

TEST_COMMAND_RE = re.compile(
    r"(?:^|\s)(?:pytest|python\s+-m\s+pytest|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|"
    r"yarn\s+test|jest|vitest|cargo\s+test|go\s+test|mvn(?:w)?\s+test|gradle(?:w)?\s+test|"
    r"dotnet\s+test|ctest)(?:\s|$)",
    re.IGNORECASE,
)
BUILD_COMMAND_RE = re.compile(
    r"(?:^|\s)(?:npm\s+run\s+(?:build|dist|package)|pnpm\s+(?:run\s+)?(?:build|dist)|"
    r"yarn\s+(?:build|dist)|electron-builder|cargo\s+build|go\s+build|mvn(?:w)?\s+package|"
    r"gradle(?:w)?\s+build|dotnet\s+(?:build|publish)|python\s+-m\s+build|pyinstaller)(?:\s|$)",
    re.IGNORECASE,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def classify_command(command: str) -> str:
    if TEST_COMMAND_RE.search(command):
        return "test"
    if BUILD_COMMAND_RE.search(command):
        return "build"
    return "command"


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    return str(value or "")[:limit]


def _default_state() -> dict[str, Any]:
    now = utc_now()
    return {
        "version": STATE_VERSION,
        "task_id": "",
        "objective": "",
        "status": "idle",
        "steps": [],
        "current_step": "",
        "current_command": None,
        "test_results": [],
        "build_results": [],
        "last_build_report": None,
        "modified_files": [],
        "failure": None,
        "next_step": "",
        "created_at": now,
        "updated_at": now,
        "events": [],
    }


class TaskStateStore:
    """Workspace-local, atomic task state used across browser chats and MCP restarts."""

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()
        self.state_dir = self.workspace / ".coding-tools"
        self.path = self.state_dir / "task-state.json"
        self.history_path = self.state_dir / "task-history.json"
        self._lock = threading.RLock()

    def get(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._read())

    def ensure_started(self, objective: str, *, current_step: str = "") -> dict[str, Any]:
        """Create a visible task automatically when a client skips explicit task setup."""
        with self._lock:
            state = self._read()
            if self._has_task(state) and str(state.get("status", "")) not in {"completed", "failed", "stopped"}:
                return copy.deepcopy(state)
            if self._has_task(state):
                self._archive(state, "finished")
            state = _default_state()
            state["task_id"] = uuid.uuid4().hex
            state["objective"] = _text(objective or "Workspace task")
            state["status"] = "active"
            state["current_step"] = _text(current_step)
            self._event(state, "task_auto_started", {"objective": state["objective"]})
            return self._write(state)

    def clear(self) -> dict[str, Any]:
        with self._lock:
            state = self._read()
            if self._has_task(state):
                self._archive(state, "cleared")
            if self.path.exists():
                self.path.unlink()
            return _default_state()

    def history(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            raw = self._read_json(self.history_path, [])
            return copy.deepcopy(raw[-max(1, min(limit, 100)):][::-1] if isinstance(raw, list) else [])

    def pause(self, reason: str = "") -> dict[str, Any]:
        with self._lock:
            state = self._read()
            if not self._has_task(state):
                return state
            state["status"] = "paused"
            state["pause_reason"] = _text(reason, 2000)
            self._event(state, "task_paused", {"reason": state["pause_reason"]})
            return self._write(state)

    def resume(self, next_step: str = "") -> dict[str, Any]:
        with self._lock:
            state = self._read()
            if not self._has_task(state):
                return state
            state["status"] = "active"
            state["pause_reason"] = ""
            if next_step:
                state["next_step"] = _text(next_step)
            self._event(state, "task_resumed", {"next_step": state.get("next_step", "")})
            return self._write(state)

    def update(self, changes: dict[str, Any], *, event: str = "task_updated") -> dict[str, Any]:
        with self._lock:
            state = self._read()
            if changes.get("objective") and not self._has_task(state):
                # Discard anonymous tool traces left before a model explicitly started a task.
                state = _default_state()
            elif changes.get("objective") and self._has_task(state) and changes.get("new_task"):
                self._archive(state, "superseded")
                state = _default_state()
            if changes.get("objective") and not state.get("task_id"):
                state["task_id"] = uuid.uuid4().hex
            for key in ("objective", "status", "current_step", "next_step"):
                if key in changes:
                    state[key] = _text(changes[key])
            if "failure" in changes:
                failure = changes["failure"]
                state["failure"] = None if failure in (None, "") else _text(failure)
            if "steps" in changes:
                state["steps"] = self._normalize_steps(changes["steps"])
            completed = {str(item) for item in changes.get("complete_step_ids", [])}
            if completed:
                for step in state["steps"]:
                    if step["id"] in completed:
                        step["status"] = "completed"
                        step["updated_at"] = utc_now()
            self._event(state, event, {"fields": sorted(changes)})
            return self._write(state)

    def record_tool_result(self, name: str, args: dict[str, Any], payload: dict[str, Any]) -> None:
        if name.startswith("task_state_") or name == "task_history_list":
            return
        with self._lock:
            state = self._read()
            if not self._has_task(state):
                return
            ok = payload.get("ok", True) is not False
            if name in {"apply_patch", "apply_changes_and_verify", "file_batch", "document_workflow", "document_create", "document_convert"} and ok and not args.get("dry_run"):
                for item in payload.get("affected_files", []):
                    if isinstance(item, dict) and item.get("path"):
                        self._add_file(state, str(item["path"]), str(item.get("operation", "update")))
                self._event(state, "files_modified", {"count": len(payload.get("affected_files", []))})
            elif name == "exec_command":
                self._record_command_payload(state, _text(args.get("cmd"), 4000), payload)
            elif name == "write_stdin":
                current = state.get("current_command")
                if isinstance(current, dict) and current.get("session_id") == payload.get("session_id"):
                    self._record_command_payload(state, _text(current.get("command"), 4000), payload)
            elif name == "kill_session":
                current = state.get("current_command")
                if isinstance(current, dict) and current.get("session_id") == args.get("session_id"):
                    current["status"] = _text(payload.get("status", "terminated"), 100)
                    current["finished_at"] = utc_now()
                    state["current_command"] = None
                    self._event(state, "command_terminated", {"session_id": args.get("session_id")})
            if not ok and name not in {"task_state_get", "task_state_update", "task_state_clear"}:
                error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
                state["failure"] = _text(error.get("message") or f"{name} failed")
                self._event(state, "tool_failed", {"tool": name, "code": error.get("code")})
            elif ok:
                state["failure"] = None
                if name == "document_workflow":
                    action = str(args.get("action", "inspect")).lower()
                    if action == "inspect":
                        state["status"] = "waiting"
                        state["current_step"] = "Waiting for model"
                        state["next_step"] = "Generate the result from the inspected content, then save it once."
                    elif action in {"create", "convert", "rebuild"}:
                        state["status"] = "completed"
                        state["current_step"] = "Completed"
                        state["next_step"] = "Review or use the generated document."
                elif name == "agent_workflow":
                    phase = str(payload.get("phase", args.get("phase", ""))).lower()
                    if phase == "prepare":
                        state["status"] = "waiting"
                        state["current_step"] = "Waiting for model"
            self._write(state)

    def record_command_started(self, command: str, session_id: str, workdir: str) -> None:
        with self._lock:
            state = self._read()
            if not self._has_task(state):
                return
            state["current_command"] = {
                "command": _text(command, 4000),
                "kind": classify_command(command),
                "session_id": session_id,
                "workdir": _text(workdir, 2000),
                "status": "running",
                "started_at": utc_now(),
            }
            self._event(state, "command_started", {"command": _text(command, 500), "session_id": session_id})
            self._write(state)

    def record_build_report(self, report: dict[str, Any]) -> None:
        with self._lock:
            state = self._read()
            if not self._has_task(state):
                project = report.get("project") if isinstance(report.get("project"), dict) else {}
                state["objective"] = f"Build and verify {_text(project.get('name') or 'project', 500)}"
                state["task_id"] = uuid.uuid4().hex
                state["status"] = "active"
            test_result = report.get("test_result")
            build_result = report.get("build_result")
            if isinstance(test_result, dict):
                state["test_results"] = (state["test_results"] + [test_result])[-MAX_RESULTS:]
            if isinstance(build_result, dict):
                state["build_results"] = (state["build_results"] + [build_result])[-MAX_RESULTS:]
            state["last_build_report"] = copy.deepcopy(report)
            status = str(report.get("overall_status", "unknown"))
            state["status"] = "completed" if status == "passed" else "failed"
            state["failure"] = None if status == "passed" else _text(report.get("failure") or "Build verification failed")
            state["next_step"] = (
                "Review or publish the verified artifacts."
                if status == "passed"
                else "Fix the failed test/build step, then run verify_build again."
            )
            self._event(state, "build_verification_finished", {"status": status})
            self._write(state)

    def _archive(self, state: dict[str, Any], reason: str) -> None:
        history = self._read_json(self.history_path, [])
        if not isinstance(history, list):
            history = []
        archived = copy.deepcopy(state)
        archived["archived_at"] = utc_now()
        archived["archive_reason"] = reason
        history = (history + [archived])[-100:]
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._write_json_atomic(self.history_path, history)

    @staticmethod
    def _read_json(path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return fallback

    @staticmethod
    def _write_json_atomic(path: Path, value: Any) -> None:
        temp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)

    @staticmethod
    def _has_task(state: dict[str, Any]) -> bool:
        return bool(
            str(state.get("objective") or "").strip()
            or state.get("steps")
            or str(state.get("current_step") or "").strip()
            or str(state.get("next_step") or "").strip()
            or str(state.get("status") or "idle") != "idle"
        )

    def _record_command_payload(self, state: dict[str, Any], command: str, payload: dict[str, Any]) -> None:
        status = str(payload.get("status", ""))
        session_id = str(payload.get("session_id", ""))
        current = state.get("current_command")
        if not isinstance(current, dict) or (session_id and current.get("session_id") != session_id):
            current = {
                "command": command,
                "kind": classify_command(command),
                "session_id": session_id,
                "status": status or "running",
                "started_at": utc_now(),
            }
        current["status"] = status or ("failed" if payload.get("ok") is False else "exited")
        current["exit_code"] = payload.get("exit_code")
        current["elapsed_ms"] = payload.get("elapsed_ms")
        if current["status"] == "running":
            state["current_command"] = current
            return
        current["finished_at"] = utc_now()
        kind = str(current.get("kind", classify_command(command)))
        result = {
            "command": command,
            "status": "passed" if payload.get("exit_code") == 0 else "failed",
            "exit_code": payload.get("exit_code"),
            "duration_ms": payload.get("elapsed_ms"),
            "summary": _text(payload.get("summary") or payload.get("stderr") or payload.get("stdout"), 2000),
            "finished_at": current["finished_at"],
        }
        if kind == "test":
            state["test_results"] = (state["test_results"] + [result])[-MAX_RESULTS:]
        elif kind == "build":
            state["build_results"] = (state["build_results"] + [result])[-MAX_RESULTS:]
        state["current_command"] = None
        state["status"] = "waiting" if result["status"] == "passed" else "failed"
        state["current_step"] = "Waiting for model" if result["status"] == "passed" else "Command failed"
        if result["status"] == "failed":
            state["failure"] = result["summary"] or f"Command failed with exit code {result['exit_code']}"
        self._event(state, "command_finished", {"command": _text(command, 500), "status": result["status"]})

    def _normalize_steps(self, raw: Any) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        now = utc_now()
        steps: list[dict[str, Any]] = []
        for index, item in enumerate(raw[:200], start=1):
            if isinstance(item, str):
                item = {"text": item}
            if not isinstance(item, dict):
                continue
            status = str(item.get("status", "pending"))
            if status not in {"pending", "in_progress", "completed", "failed"}:
                status = "pending"
            steps.append({
                "id": _text(item.get("id") or f"step-{index}", 200),
                "text": _text(item.get("text"), 4000),
                "status": status,
                "updated_at": _text(item.get("updated_at") or now, 100),
            })
        return steps

    def _add_file(self, state: dict[str, Any], path: str, operation: str) -> None:
        existing = {item.get("path"): item for item in state["modified_files"] if isinstance(item, dict)}
        existing[path] = {"path": _text(path, 2000), "operation": _text(operation, 100), "updated_at": utc_now()}
        state["modified_files"] = list(existing.values())[-MAX_FILES:]

    def _event(self, state: dict[str, Any], event: str, details: dict[str, Any]) -> None:
        state["events"] = (state.get("events", []) + [{"time": utc_now(), "event": event, "details": details}])[-MAX_EVENTS:]

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return _default_state()
        try:
            parsed = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = _default_state()
            state["failure"] = "The previous task-state file was unreadable and has been reset."
            return state
        state = _default_state()
        if isinstance(parsed, dict):
            state.update(parsed)
        state["version"] = STATE_VERSION
        for key in ("steps", "test_results", "build_results", "modified_files", "events"):
            if not isinstance(state.get(key), list):
                state[key] = []
        if state.get("status") == "active" and not state.get("current_command"):
            try:
                updated = datetime.fromisoformat(str(state.get("updated_at", "")).replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - updated).total_seconds() >= STALE_ACTIVE_SECONDS:
                    state["status"] = "waiting"
                    state["current_step"] = "Waiting for model"
            except ValueError:
                pass
        return state

    def _write(self, state: dict[str, Any]) -> dict[str, Any]:
        state["updated_at"] = utc_now()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f".{self.path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temp, self.path)
        finally:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
        return copy.deepcopy(state)
