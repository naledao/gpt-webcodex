from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SOURCE_ROOT = Path(__file__).resolve().parents[1]
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from coding_tools_mcp.project_context import MAX_GLOBAL_CONTEXT_BYTES, _global_context_path, load_project_context
from coding_tools_mcp.server import Runtime


class ProjectContextTests(unittest.TestCase):
    def test_global_path_defaults_to_dot_codex_under_home(self) -> None:
        with tempfile.TemporaryDirectory() as home_temp, patch.dict(os.environ, {}, clear=True), patch(
            "coding_tools_mcp.project_context.Path.home", return_value=Path(home_temp)
        ):
            self.assertEqual(_global_context_path(), Path(home_temp) / ".codex" / "AGENTS.md")

    def test_global_instructions_precede_project_instructions(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            codex_home = Path(codex_temp)
            (codex_home / "AGENTS.md").write_text("global rule\n", encoding="utf-8")
            (workspace / "AGENTS.md").write_text("project rule\n", encoding="utf-8")

            with patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}):
                context = load_project_context(workspace)

            self.assertEqual(len(context.global_files), 1)
            self.assertEqual(context.global_files[0].content.strip(), "global rule")
            self.assertEqual(context.root_files[0].content.strip(), "project rule")
            instructions = context.server_instructions()
            self.assertLess(instructions.index("global rule"), instructions.index("project rule"))
            self.assertIn("the more specific project instruction wins", instructions)

    def test_missing_global_instructions_are_optional(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            with patch.dict(os.environ, {"CODEX_HOME": codex_temp}):
                context = load_project_context(Path(workspace_temp))

            self.assertEqual(context.global_files, ())
            self.assertEqual(context.warnings, ())

    def test_global_instructions_are_bounded_and_reported_by_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            codex_home = Path(codex_temp)
            (codex_home / "AGENTS.md").write_text("g" * (MAX_GLOBAL_CONTEXT_BYTES + 32), encoding="utf-8")

            with patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}):
                runtime = Runtime(workspace)
                initialized = runtime.initialize()
                server_info = runtime.server_info({})
                prepared = runtime.prepare_coding_context({"objective": "inspect instructions"})
                runtime.close()

            self.assertIn("Global instructions from", initialized["instructions"])
            self.assertTrue(runtime.project_context.global_files[0].truncated)
            self.assertEqual(len(runtime.project_context.global_files[0].content.encode("utf-8")), MAX_GLOBAL_CONTEXT_BYTES)
            self.assertEqual(server_info["project_context"]["global_instruction_files"], [str((codex_home / "AGENTS.md").resolve())])
            self.assertEqual(prepared["instructions"]["global"][0]["truncated"], True)


if __name__ == "__main__":
    unittest.main()
