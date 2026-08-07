from __future__ import annotations

import hashlib
import json
import os
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


CommandRunner = Callable[[str, Path, int], dict[str, Any]]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def detect_project(root: Path) -> dict[str, Any]:
    package = _read_json(root / "package.json") if (root / "package.json").is_file() else {}
    if package:
        scripts = package.get("scripts") if isinstance(package.get("scripts"), dict) else {}
        manager = "pnpm" if (root / "pnpm-lock.yaml").exists() else "yarn" if (root / "yarn.lock").exists() else "npm"
        dependencies = package.get("dependencies") if isinstance(package.get("dependencies"), dict) else {}
        dev_dependencies = package.get("devDependencies") if isinstance(package.get("devDependencies"), dict) else {}
        kind = "electron" if package.get("main") or "electron" in {**dependencies, **dev_dependencies} else "node"
        run = "run " if manager in {"npm", "pnpm"} else ""
        test = f"{manager} {run}test" if scripts.get("test") and "no test specified" not in str(scripts.get("test")).lower() else ""
        build_name = next((name for name in ("build", "dist", "package") if scripts.get(name)), "")
        build = f"{manager} {run}{build_name}" if build_name else ""
        output_dirs = []
        builder = package.get("build") if isinstance(package.get("build"), dict) else {}
        directories = builder.get("directories") if isinstance(builder.get("directories"), dict) else {}
        if directories.get("output"):
            output_dirs.append(str(directories["output"]))
        output_dirs.extend(["dist", "build"])
        return {"type": kind, "name": package.get("name", root.name), "version": package.get("version", ""), "package_manager": manager, "test_command": test, "build_command": build, "artifact_paths": list(dict.fromkeys(output_dirs))}
    pyproject = root / "pyproject.toml"
    if pyproject.is_file():
        try:
            parsed = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            parsed = {}
        project = parsed.get("project") if isinstance(parsed.get("project"), dict) else {}
        return {"type": "python", "name": project.get("name", root.name), "version": project.get("version", ""), "package_manager": "pip", "test_command": "python -m pytest" if any((root / name).exists() for name in ("tests", "pytest.ini")) else "", "build_command": "python -m build", "artifact_paths": ["dist"]}
    cargo = root / "Cargo.toml"
    if cargo.is_file():
        try:
            parsed = tomllib.loads(cargo.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            parsed = {}
        package = parsed.get("package") if isinstance(parsed.get("package"), dict) else {}
        return {"type": "rust", "name": package.get("name", root.name), "version": package.get("version", ""), "package_manager": "cargo", "test_command": "cargo test", "build_command": "cargo build --release", "artifact_paths": ["target/release"]}
    if (root / "go.mod").is_file():
        first = (root / "go.mod").read_text(encoding="utf-8", errors="replace").splitlines()[:1]
        name = first[0].removeprefix("module ").strip() if first else root.name
        return {"type": "go", "name": name, "version": "", "package_manager": "go", "test_command": "go test ./...", "build_command": "go build ./...", "artifact_paths": ["bin", "."]}
    if (root / "pom.xml").is_file():
        return {"type": "maven", "name": root.name, "version": "", "package_manager": "maven", "test_command": "mvn test", "build_command": "mvn package", "artifact_paths": ["target"]}
    if any(root.glob("*.sln")) or any(root.glob("*.csproj")):
        return {"type": "dotnet", "name": root.name, "version": "", "package_manager": "dotnet", "test_command": "dotnet test", "build_command": "dotnet build --configuration Release", "artifact_paths": ["bin/Release"]}
    return {"type": "unknown", "name": root.name, "version": "", "package_manager": "", "test_command": "", "build_command": "", "artifact_paths": []}


def _hash_file(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def collect_artifacts(root: Path, patterns: list[str], algorithm: str, started_ns: int) -> list[dict[str, Any]]:
    found: dict[Path, None] = {}
    for raw in patterns:
        candidate = (root / raw).resolve()
        try:
            candidate.relative_to(root.resolve())
        except ValueError:
            continue
        matches = list(root.glob(raw)) if any(ch in raw for ch in "*?[") else [candidate]
        for match in matches:
            if match.is_file():
                found[match] = None
            elif match.is_dir():
                for file in match.rglob("*"):
                    if file.is_file():
                        found[file] = None
    artifacts = []
    for path in sorted(found, key=lambda item: item.as_posix())[:500]:
        stat = path.stat()
        artifacts.append({"path": path.relative_to(root).as_posix(), "size": stat.st_size, "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"), algorithm: _hash_file(path, algorithm)})
    return artifacts


def verify_build(root: Path, args: dict[str, Any], runner: CommandRunner) -> dict[str, Any]:
    root = root.resolve()
    project = detect_project(root)
    test_command = str(args.get("test_command") or project["test_command"])
    build_command = str(args.get("build_command") or project["build_command"])
    run_tests = bool(args.get("run_tests", True))
    run_build = bool(args.get("run_build", True))
    timeout = int(args.get("timeout_seconds", 900))
    algorithm = str(args.get("hash_algorithm", "sha256")).lower()
    if algorithm not in hashlib.algorithms_available or algorithm not in {"sha256", "sha384", "sha512"}:
        algorithm = "sha256"
    started_ns = int(datetime.now().timestamp() * 1_000_000_000)
    test_result = None
    build_result = None
    failure = ""
    if run_tests:
        if not test_command:
            test_result = {"status": "skipped", "command": "", "summary": "No test command was detected."}
        else:
            test_result = runner(test_command, root, timeout)
            if test_result.get("status") != "passed":
                failure = "Tests failed."
    if run_build and not failure:
        if not build_command:
            build_result = {"status": "skipped", "command": "", "summary": "No build command was detected."}
            failure = "No build command was detected."
        else:
            build_result = runner(build_command, root, timeout)
            if build_result.get("status") != "passed":
                failure = "Build failed."
    patterns = [str(item) for item in args.get("artifact_paths", [])] or list(project["artifact_paths"])
    artifacts = collect_artifacts(root, patterns, algorithm, started_ns) if not failure else []
    if run_build and build_result and build_result.get("status") == "passed" and not artifacts:
        failure = "Build command passed, but no newly generated artifact was found."
    overall = "passed" if not failure else "failed"
    return {"project": project, "commands": {"test": test_command, "build": build_command}, "test_result": test_result, "build_result": build_result, "artifacts": artifacts, "hash_algorithm": algorithm, "overall_status": overall, "failure": failure or None, "report_generated_at": _now()}
