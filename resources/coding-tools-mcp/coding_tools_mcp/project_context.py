from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CONTEXT_FILE_NAMES = frozenset({"AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"})
GLOBAL_CONTEXT_FILE_NAME = "AGENTS.md"
DEFAULT_CODEX_HOME_DIR_NAME = ".codex"
SKIPPED_CONTEXT_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".reference",
        "node_modules",
        "target",
        "dist",
        "build",
        ".venv",
        "venv",
        ".tox",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "__pycache__",
    }
)
MAX_ROOT_CONTEXT_BYTES = 32 * 1024
MAX_GLOBAL_CONTEXT_BYTES = 16 * 1024
MAX_CONTEXT_FILE_BYTES = 16 * 1024
MAX_NESTED_CONTEXT_FILES = 64
MAX_CONTEXT_SCAN_FILES = 20_000
MAX_CONTEXT_SCAN_DEPTH = 12
INSTRUCTION_SHARING_MODES = frozenset({"off", "metadata", "content"})
ROUTING_INSTRUCTIONS = (
    "Before answering workspace, machine, or instruction questions, call workspace_context. "
    "Before coding, call agent_workflow with phase=prepare or run. Treat the returned global, "
    "project-root, and applicable nested AGENTS.md as authoritative; nested overrides root, and "
    "root overrides global. Never claim instructions are absent unless the context result reports "
    "them missing or withheld by policy."
)


def _hidden_process_kwargs() -> dict[str, int]:
    if os.name != "nt":
        return {}
    creation_flag = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return {"creationflags": creation_flag} if creation_flag else {}


@dataclass(frozen=True)
class LoadedContextFile:
    path: str
    content: str
    truncated: bool
    size_bytes: int = 0


@dataclass(frozen=True)
class ContextFileIssue:
    scope: str
    path: str
    status: str
    message: str


@dataclass(frozen=True)
class ProjectContext:
    global_files: tuple[LoadedContextFile, ...]
    root_files: tuple[LoadedContextFile, ...]
    nested_files: tuple[str, ...]
    warnings: tuple[str, ...]
    nested_context_files: tuple[LoadedContextFile, ...] = ()
    issues: tuple[ContextFileIssue, ...] = ()
    workspace_root: str = ""
    source_signature: str = ""

    @staticmethod
    def routing_instructions() -> str:
        """Return stable discovery guidance without embedding local file contents."""

        return ROUTING_INSTRUCTIONS

    def server_instructions(self) -> str:
        """Compatibility alias retained for callers that used the old method name."""

        return self.routing_instructions()

    def applicable_instructions(
        self,
        target_paths: list[str] | tuple[str, ...],
        sharing_mode: str,
    ) -> dict[str, object]:
        """Assemble the one authoritative instruction payload for target paths."""

        mode = sharing_mode.strip().lower()
        if mode not in INSTRUCTION_SHARING_MODES:
            mode = "metadata"
        root = Path(self.workspace_root).resolve(strict=False)
        normalized_targets, target_warnings = _normalize_target_paths(root, target_paths)
        precedence = ["global", "project_root", "nested"]
        if mode == "off":
            revision = _payload_revision({"sharing_mode": "off", "status": "withheld"})
            return {
                "revision": revision,
                "sharing_mode": mode,
                "requested_paths": [],
                "precedence": precedence,
                "files": [],
                "missing": [],
                "unavailable": [],
                "withheld": [{"scope": "all", "reason": "sharing_mode_off"}],
                "warnings": ["Instruction sharing is disabled by local policy."],
            }

        ordered: list[tuple[str, LoadedContextFile, list[str]]] = []
        for item in self.global_files:
            ordered.append(("global", item, list(normalized_targets)))
        for item in self.root_files:
            ordered.append(("project_root", item, list(normalized_targets)))

        nested_by_path = {
            Path(item.path).resolve(strict=False): item for item in self.nested_context_files
        }
        for relative in sorted(self.nested_files, key=lambda value: (len(Path(value).parts), value)):
            absolute = (root / relative).resolve(strict=False)
            item = nested_by_path.get(absolute)
            if item is None:
                continue
            scope_dir = absolute.parent
            applicable_to = [
                display
                for display in normalized_targets
                if _path_is_within(_target_absolute(root, display), scope_dir)
            ]
            if applicable_to:
                ordered.append(("nested", item, applicable_to))

        files: list[dict[str, Any]] = []
        withheld: list[dict[str, Any]] = []
        revision_files: list[dict[str, Any]] = []
        applicable_paths = {str(Path(item.path).resolve(strict=False)) for _, item, _ in ordered}
        for scope, item, applicable_to in ordered:
            record: dict[str, Any] = {
                "scope": scope,
                "path": item.path,
                "size_bytes": item.size_bytes,
                "loaded_bytes": len(item.content.encode("utf-8")),
                "truncated": item.truncated,
                "applicable_to": applicable_to,
                "content_status": "available" if mode == "content" else "withheld",
            }
            if mode == "content":
                record["content"] = item.content
            else:
                withheld.append({
                    "scope": scope,
                    "path": item.path,
                    "reason": "metadata_only",
                })
            files.append(record)
            revision_files.append({
                "scope": scope,
                "path": item.path,
                "content": item.content,
                "truncated": item.truncated,
                "applicable_to": applicable_to,
            })

        missing: list[dict[str, str]] = []
        unavailable: list[dict[str, str]] = []
        for issue in self.issues:
            issue_path = str(Path(issue.path).absolute())
            if issue.scope == "nested" and issue_path not in applicable_paths:
                scope_dir = Path(issue_path).parent
                if not any(_path_is_within(_target_absolute(root, item), scope_dir) for item in normalized_targets):
                    continue
            record = {
                "scope": issue.scope,
                "path": issue.path,
                "status": issue.status,
                "message": issue.message,
            }
            if issue.status == "missing":
                missing.append(record)
            else:
                unavailable.append(record)

        revision = _payload_revision({
            "requested_paths": normalized_targets,
            "files": revision_files,
            "missing": missing,
            "unavailable": unavailable,
        })
        return {
            "revision": revision,
            "sharing_mode": mode,
            "requested_paths": normalized_targets,
            "precedence": precedence,
            "files": files,
            "missing": missing,
            "unavailable": unavailable,
            "withheld": withheld,
            "warnings": list(dict.fromkeys([*self.warnings, *target_warnings])),
        }


def load_project_context(root: Path) -> ProjectContext:
    resolved_root = root.expanduser().resolve(strict=True)
    global_files: list[LoadedContextFile] = []
    loaded: list[LoadedContextFile] = []
    nested_loaded: list[LoadedContextFile] = []
    warnings: list[str] = []
    issues: list[ContextFileIssue] = []
    global_path = _global_context_path().resolve(strict=False)
    try:
        if global_path.exists() or global_path.is_symlink():
            resolved_global = global_path.resolve(strict=True)
            if not resolved_global.is_file():
                raise OSError("path is not a regular file")
            global_files.append(_load_context_file(resolved_global, MAX_GLOBAL_CONTEXT_BYTES))
        else:
            issues.append(ContextFileIssue("global", str(global_path), "missing", "Global AGENTS.md was not found."))
    except UnicodeDecodeError:
        message = f"Skipped non-UTF-8 global instruction file: {global_path}"
        warnings.append(message)
        issues.append(ContextFileIssue("global", str(global_path), "unavailable", message))
    except (OSError, RuntimeError) as exc:
        message = f"Could not read global {GLOBAL_CONTEXT_FILE_NAME}: {exc}"
        warnings.append(message)
        issues.append(ContextFileIssue("global", str(global_path), "unavailable", message))

    remaining = MAX_ROOT_CONTEXT_BYTES
    root_candidate_seen = False
    for name in sorted(CONTEXT_FILE_NAMES):
        path = resolved_root / name
        if not (path.exists() or path.is_symlink()):
            continue
        root_candidate_seen = True
        try:
            resolved = path.resolve(strict=True)
            resolved.relative_to(resolved_root)
            if not resolved.is_file():
                raise OSError("path is not a regular file")
        except (OSError, ValueError):
            message = f"Skipped unsafe root instruction path: {name}"
            warnings.append(message)
            issues.append(ContextFileIssue("project_root", str(path), "unavailable", message))
            continue
        if remaining <= 0:
            message = "Root instruction byte limit reached."
            warnings.append(message)
            issues.append(ContextFileIssue("project_root", str(resolved), "unavailable", message))
            break
        budget = min(MAX_CONTEXT_FILE_BYTES, remaining)
        try:
            item = _load_context_file(resolved, budget)
        except UnicodeDecodeError:
            message = f"Skipped non-UTF-8 instruction file: {name}"
            warnings.append(message)
            issues.append(ContextFileIssue("project_root", str(resolved), "unavailable", message))
            continue
        except OSError as exc:
            message = f"Could not read {name}: {exc}"
            warnings.append(message)
            issues.append(ContextFileIssue("project_root", str(resolved), "unavailable", message))
            continue
        loaded.append(item)
        remaining -= len(item.content.encode("utf-8"))

    if not root_candidate_seen:
        issues.append(ContextFileIssue(
            "project_root",
            str(resolved_root),
            "missing",
            "No project-root instruction file was found.",
        ))

    loaded_names = {Path(item.path).name for item in loaded}
    nested = [
        path for path in _discover_context_files(resolved_root, warnings)
        if not (len(Path(path).parts) == 1 and Path(path).name in loaded_names)
    ]
    if len(nested) > MAX_NESTED_CONTEXT_FILES:
        nested = nested[:MAX_NESTED_CONTEXT_FILES]
        warnings.append(f"Nested instruction list truncated to {MAX_NESTED_CONTEXT_FILES} files.")
    safe_nested: list[str] = []
    for relative in nested:
        path = resolved_root / relative
        try:
            if path.is_symlink():
                raise OSError("symbolic links are not allowed")
            resolved = path.resolve(strict=True)
            resolved.relative_to(resolved_root)
            if not resolved.is_file():
                raise OSError("path is not a regular file")
            item = _load_context_file(resolved, MAX_CONTEXT_FILE_BYTES)
        except UnicodeDecodeError:
            message = f"Skipped non-UTF-8 nested instruction file: {relative}"
            warnings.append(message)
            issues.append(ContextFileIssue("nested", str(path), "unavailable", message))
            safe_nested.append(relative)
            continue
        except (OSError, ValueError) as exc:
            message = f"Skipped unsafe or unreadable nested instruction path {relative}: {exc}"
            warnings.append(message)
            issues.append(ContextFileIssue("nested", str(path), "unavailable", message))
            safe_nested.append(relative)
            continue
        safe_nested.append(relative)
        nested_loaded.append(item)

    source_signature = _payload_revision({
        "workspace": str(resolved_root),
        "files": [
            {
                "path": item.path,
                "content": item.content,
                "truncated": item.truncated,
                "size_bytes": item.size_bytes,
            }
            for item in [*global_files, *loaded, *nested_loaded]
        ],
        "nested_paths": safe_nested,
        "issues": [issue.__dict__ for issue in issues],
        "warnings": warnings,
    })
    return ProjectContext(
        tuple(global_files),
        tuple(loaded),
        tuple(safe_nested),
        tuple(warnings),
        tuple(nested_loaded),
        tuple(issues),
        str(resolved_root),
        source_signature,
    )


def _load_context_file(path: Path, limit: int) -> LoadedContextFile:
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    content = _decode_utf8_prefix(data[:limit])
    try:
        size_bytes = path.stat().st_size
    except OSError:
        size_bytes = len(data)
    return LoadedContextFile(str(path), content, len(data) > limit, size_bytes)


def _payload_revision(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _path_is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _target_absolute(root: Path, display: str) -> Path:
    return root if display == "." else (root / display).resolve(strict=False)


def _normalize_target_paths(root: Path, target_paths: list[str] | tuple[str, ...]) -> tuple[list[str], list[str]]:
    normalized: list[str] = []
    warnings: list[str] = []
    raw_values = [str(item).strip() for item in target_paths if str(item).strip()]
    if not raw_values:
        raw_values = ["."]
    for raw in raw_values:
        try:
            candidate = Path(raw).expanduser()
            absolute = candidate.resolve(strict=False) if candidate.is_absolute() else (root / candidate).resolve(strict=False)
            relative = absolute.relative_to(root)
        except (OSError, ValueError):
            warnings.append(f"Ignored instruction target outside the workspace: {raw}")
            continue
        display = relative.as_posix() if relative.parts else "."
        if display not in normalized:
            normalized.append(display)
    if not normalized:
        normalized.append(".")
    return normalized, warnings


def _global_context_path() -> Path:
    configured_home = os.environ.get("CODEX_HOME", "").strip()
    codex_home = Path(configured_home).expanduser() if configured_home else Path.home() / DEFAULT_CODEX_HOME_DIR_NAME
    return codex_home / GLOBAL_CONTEXT_FILE_NAME


def _discover_context_files(root: Path, warnings: list[str]) -> list[str]:
    git_paths = _git_context_files(root)
    if git_paths is not None:
        return git_paths
    discovered: list[str] = []
    scanned = 0
    for current, dirs, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        depth = len(current_path.relative_to(root).parts)
        dirs[:] = sorted(
            name
            for name in dirs
            if name not in SKIPPED_CONTEXT_DIRS and depth < MAX_CONTEXT_SCAN_DEPTH
        )
        for name in sorted(files):
            scanned += 1
            if scanned > MAX_CONTEXT_SCAN_FILES:
                warnings.append(f"Project-context scan stopped after {MAX_CONTEXT_SCAN_FILES} files.")
                return discovered
            if name not in CONTEXT_FILE_NAMES:
                continue
            path = current_path / name
            discovered.append(path.relative_to(root).as_posix())
    return discovered


def _git_context_files(root: Path) -> list[str] | None:
    pathspecs = sorted(CONTEXT_FILE_NAMES) + [
        f":(glob)**/{name}" for name in sorted(CONTEXT_FILE_NAMES)
    ]
    try:
        completed = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "ls-files",
                "-co",
                "--exclude-standard",
                "-z",
                "--",
                *pathspecs,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            **_hidden_process_kwargs(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    paths: list[str] = []
    for raw in completed.stdout.split(b"\0"):
        if not raw:
            continue
        try:
            path = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        parts = Path(path).parts
        if len(parts) > MAX_CONTEXT_SCAN_DEPTH + 1 or any(part in SKIPPED_CONTEXT_DIRS for part in parts[:-1]):
            continue
        if parts and parts[-1] in CONTEXT_FILE_NAMES:
            paths.append(Path(path).as_posix())
        if len(paths) >= MAX_NESTED_CONTEXT_FILES + 1:
            break
    return sorted(set(paths))


def _decode_utf8_prefix(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        if exc.reason != "unexpected end of data":
            raise
        return data[: exc.start].decode("utf-8")
