from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from coding_tools_mcp.project_context import load_project_context
from coding_tools_mcp.server import Runtime


class GlobalProjectContextTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.base = Path(self._temp.name)
        self.workspace = self.base / "workspace"
        self.codex_home = self.base / "codex-home"
        self.workspace.mkdir()
        self.codex_home.mkdir()

    def tearDown(self) -> None:
        self._temp.cleanup()

    def test_global_context_is_opt_in(self) -> None:
        (self.codex_home / "AGENTS.md").write_text("global rule", encoding="utf-8")

        context = load_project_context(
            self.workspace,
            include_global=False,
            codex_home=self.codex_home,
        )

        self.assertEqual(context.global_files, ())
        self.assertNotIn("global rule", context.server_instructions())

    def test_global_context_precedes_project_context(self) -> None:
        (self.codex_home / "AGENTS.md").write_text("global rule", encoding="utf-8")
        (self.workspace / "AGENTS.md").write_text("project rule", encoding="utf-8")

        context = load_project_context(
            self.workspace,
            include_global=True,
            codex_home=self.codex_home,
        )

        self.assertEqual(len(context.global_files), 1)
        instructions = context.server_instructions()
        self.assertLess(instructions.index("global rule"), instructions.index("project rule"))
        self.assertIn("project instructions below take precedence", instructions)

    def test_non_empty_override_wins_and_empty_override_falls_back(self) -> None:
        override = self.codex_home / "AGENTS.override.md"
        standard = self.codex_home / "AGENTS.md"
        override.write_text("  \n", encoding="utf-8")
        standard.write_text("standard rule", encoding="utf-8")

        fallback = load_project_context(
            self.workspace,
            include_global=True,
            codex_home=self.codex_home,
        )
        self.assertEqual(Path(fallback.global_files[0].path).name, "AGENTS.md")

        override.write_text("override rule", encoding="utf-8")
        selected = load_project_context(
            self.workspace,
            include_global=True,
            codex_home=self.codex_home,
        )
        self.assertEqual(Path(selected.global_files[0].path).name, "AGENTS.override.md")
        self.assertEqual(selected.global_files[0].content, "override rule")

    def test_environment_enables_custom_codex_home(self) -> None:
        (self.codex_home / "AGENTS.md").write_text("environment rule", encoding="utf-8")

        with patch.dict(
            os.environ,
            {
                "CODING_TOOLS_MCP_GLOBAL_AGENTS": "1",
                "CODEX_HOME": str(self.codex_home),
            },
            clear=False,
        ):
            context = load_project_context(self.workspace)

        self.assertEqual(context.global_files[0].content, "environment rule")

    def test_runtime_exposes_global_context_in_initialize_and_prepare(self) -> None:
        (self.codex_home / "AGENTS.md").write_text("runtime global rule", encoding="utf-8")
        context = load_project_context(
            self.workspace,
            include_global=True,
            codex_home=self.codex_home,
        )
        runtime = Runtime(self.workspace, project_context=context)
        try:
            initialized = runtime.initialize()
            prepared = runtime.prepare_coding_context({"objective": "inspect instructions"})
        finally:
            runtime.close()

        self.assertIn("runtime global rule", initialized["instructions"])
        self.assertEqual(prepared["instructions"]["global"][0]["content"], "runtime global rule")


if __name__ == "__main__":
    unittest.main()
