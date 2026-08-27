from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .envutils import ENV_PREFIX, truthy_env


CONTEXT_FILE_NAMES = ("AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD")
GLOBAL_CONTEXT_FILE_NAMES = ("AGENTS.override.md", "AGENTS.md")
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
MAX_CONTEXT_FILE_BYTES = 16 * 1024
MAX_GLOBAL_CONTEXT_BYTES = 16 * 1024
MAX_NESTED_CONTEXT_FILES = 64
MAX_CONTEXT_SCAN_FILES = 20_000


def _hidden_process_kwargs() -> dict[str, int]:
    if os.name != "nt":
        return {}
    creation_flag = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return {"creationflags": creation_flag} if creation_flag else {}
MAX_CONTEXT_SCAN_DEPTH = 12


@dataclass(frozen=True)
class LoadedContextFile:
    path: str
    content: str
    truncated: bool


@dataclass(frozen=True)
class ProjectContext:
    root_files: tuple[LoadedContextFile, ...]
    nested_files: tuple[str, ...]
    warnings: tuple[str, ...]
    global_files: tuple[LoadedContextFile, ...] = ()

    def server_instructions(self) -> str:
        sections = [
            "Use these tools only for coding operations inside the configured workspace.",
            "The compact tool surface is fixed: workspace_context, agent_workflow, task_control, exec_command, command_control, document_workflow, request_permissions, and view_image. Do not search for legacy tool names.",
            "Use workspace_context once for simple directory inspection. Use agent_workflow as the primary tool for diagnosis, code changes, tests, builds, releases, and interrupted-task resume.",
            "For file changes, send one complete change set through agent_workflow instead of assembling many low-level calls. Legacy tool names may be accepted only for cached-client compatibility and should not be selected deliberately.",
            "For commands expected to exceed 30 seconds, start them with exec_command and return control; continue with command_control so the user can see progress between polls.",
            "For any task likely to exceed 90 seconds, tell the user the plan before starting. Long agent_workflow execution is forcibly handed back after 90 seconds as a background_operation. If any tool result contains requires_progress_report=true, you MUST send the user a visible progress update before making another tool call. Then poll with task_control action=operation and wait_ms up to 60000. If it is still running, report progress again before polling again. Never stay silent for more than 120 seconds.",
            "Do not repeat successful inspection, search, read, Git, test, or build work unless files changed or the previous result was incomplete.",
            "For PDF, DOCX, Markdown, text, resume, report, or document conversion tasks, use document_workflow directly. Inspect source once, then create the complete output once.",
            "Use task_control to start, pause, stop, resume, clear, inspect persisted task state, or poll a background operation returned by a long workflow.",
            "Before claiming a build is ready, use agent_workflow with build_release and full verification so artifacts, versions, hashes, and the final report are checked consistently.",
        ]
        for item in self.global_files:
            suffix = " [truncated]" if item.truncated else ""
            sections.append(
                f"Global instructions from {item.path}{suffix} (project instructions below take precedence):\n"
                f"{item.content}"
            )
        for item in self.root_files:
            suffix = " [truncated]" if item.truncated else ""
            sections.append(f"Project instructions from {item.path}{suffix}:\n{item.content}")
        if self.nested_files:
            paths = "\n".join(f"- {path}" for path in self.nested_files)
            sections.append(
                "Nested project instruction files are available below. Before modifying files under one of their "
                f"directories, include the applicable instruction file in agent_workflow phase=prepare:\n{paths}"
            )
        if self.warnings:
            sections.append("Project-context warnings:\n" + "\n".join(f"- {warning}" for warning in self.warnings))
        return "\n\n".join(sections)


def load_project_context(
    root: Path,
    *,
    include_global: bool | None = None,
    codex_home: Path | None = None,
) -> ProjectContext:
    resolved_root = root.expanduser().resolve(strict=True)
    loaded: list[LoadedContextFile] = []
    warnings: list[str] = []
    if include_global is None:
        include_global = truthy_env(os.environ.get(f"{ENV_PREFIX}_GLOBAL_AGENTS"))
    global_files = _load_global_context(codex_home, warnings) if include_global else ()
    global_bytes = sum(len(item.content.encode("utf-8")) for item in global_files)
    remaining = max(0, MAX_ROOT_CONTEXT_BYTES - global_bytes)
    seen_root_paths: set[str] = set()
    for name in CONTEXT_FILE_NAMES:
        path = resolved_root / name
        if not path.is_file():
            continue
        try:
            resolved = path.resolve(strict=True)
            resolved.relative_to(resolved_root)
        except (OSError, ValueError):
            warnings.append(f"Skipped unsafe root instruction path: {name}")
            continue
        resolved_key = os.path.normcase(str(resolved))
        if resolved_key in seen_root_paths:
            continue
        seen_root_paths.add(resolved_key)
        if remaining <= 0:
            warnings.append("Root instruction byte limit reached.")
            break
        budget = min(MAX_CONTEXT_FILE_BYTES, remaining)
        try:
            with resolved.open("rb") as handle:
                data = handle.read(budget + 1)
            content = _decode_utf8_prefix(data[:budget])
        except UnicodeDecodeError:
            warnings.append(f"Skipped non-UTF-8 instruction file: {name}")
            continue
        except OSError as exc:
            warnings.append(f"Could not read {name}: {exc}")
            continue
        truncated = len(data) > budget
        loaded.append(LoadedContextFile(name, content, truncated))
        remaining -= len(content.encode("utf-8"))

    loaded_names = {item.path for item in loaded}
    nested = [path for path in _discover_context_files(resolved_root, warnings) if path not in loaded_names]
    if len(nested) > MAX_NESTED_CONTEXT_FILES:
        nested = nested[:MAX_NESTED_CONTEXT_FILES]
        warnings.append(f"Nested instruction list truncated to {MAX_NESTED_CONTEXT_FILES} files.")
    return ProjectContext(tuple(loaded), tuple(nested), tuple(warnings), global_files)


def _load_global_context(
    codex_home: Path | None,
    warnings: list[str],
) -> tuple[LoadedContextFile, ...]:
    configured_home = (os.environ.get("CODEX_HOME") or "").strip()
    home_candidate = codex_home or (Path(configured_home) if configured_home else Path.home() / ".codex")
    try:
        resolved_home = home_candidate.expanduser().resolve(strict=True)
    except OSError as exc:
        if codex_home is not None or configured_home:
            warnings.append(f"Could not access Codex home for global instructions: {exc}")
        return ()
    if not resolved_home.is_dir():
        warnings.append(f"Codex home is not a directory: {resolved_home}")
        return ()

    for name in GLOBAL_CONTEXT_FILE_NAMES:
        path = resolved_home / name
        if not path.is_file():
            continue
        try:
            resolved = path.resolve(strict=True)
            resolved.relative_to(resolved_home)
        except (OSError, ValueError):
            warnings.append(f"Skipped unsafe global instruction path: {path}")
            continue
        try:
            with resolved.open("rb") as handle:
                data = handle.read(MAX_GLOBAL_CONTEXT_BYTES + 1)
            content = _decode_utf8_prefix(data[:MAX_GLOBAL_CONTEXT_BYTES])
        except UnicodeDecodeError:
            warnings.append(f"Skipped non-UTF-8 global instruction file: {resolved}")
            continue
        except OSError as exc:
            warnings.append(f"Could not read global instruction file {resolved}: {exc}")
            continue
        if not content.strip():
            continue
        return (
            LoadedContextFile(
                str(resolved),
                content,
                len(data) > MAX_GLOBAL_CONTEXT_BYTES,
            ),
        )
    return ()


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
            if path.is_symlink():
                continue
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
