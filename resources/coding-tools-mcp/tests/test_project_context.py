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

from coding_tools_mcp.project_context import (  # noqa: E402
    MAX_GLOBAL_CONTEXT_BYTES,
    ProjectContext,
    _global_context_path,
    load_project_context,
)
from coding_tools_mcp.protocol import dispatch_rpc  # noqa: E402
from coding_tools_mcp.server import Runtime  # noqa: E402


class ProjectContextTests(unittest.TestCase):
    def test_global_path_defaults_to_dot_codex_under_home(self) -> None:
        with tempfile.TemporaryDirectory() as home_temp, patch.dict(os.environ, {}, clear=True), patch(
            "coding_tools_mcp.project_context.Path.home", return_value=Path(home_temp)
        ):
            self.assertEqual(_global_context_path(), Path(home_temp) / ".codex" / "AGENTS.md")

    def test_routing_instructions_are_short_and_contain_no_file_body(self) -> None:
        routing = ProjectContext.routing_instructions()
        self.assertLessEqual(routing.index("Never claim instructions are absent") + len("Never claim instructions are absent"), 512)
        self.assertIn("call workspace_context", routing)
        self.assertNotIn("secret sentinel", routing)

    def test_global_root_and_nested_rules_have_scoped_precedence(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            codex_home = Path(codex_temp)
            (codex_home / "AGENTS.md").write_text("global rule\n", encoding="utf-8")
            (workspace / "AGENTS.md").write_text("project rule\n", encoding="utf-8")
            (workspace / "a" / "deep").mkdir(parents=True)
            (workspace / "b").mkdir()
            (workspace / "a" / "AGENTS.md").write_text("a rule\n", encoding="utf-8")
            (workspace / "a" / "deep" / "AGENTS.md").write_text("deep rule\n", encoding="utf-8")
            (workspace / "b" / "AGENTS.md").write_text("b rule\n", encoding="utf-8")

            with patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}):
                context = load_project_context(workspace)
                payload = context.applicable_instructions(["a/deep/file.py", "b/file.py"], "content")

            contents = [item["content"].strip() for item in payload["files"]]
            self.assertEqual(contents, ["global rule", "project rule", "a rule", "b rule", "deep rule"])
            nested = [item for item in payload["files"] if item["scope"] == "nested"]
            self.assertEqual(nested[0]["applicable_to"], ["a/deep/file.py"])
            self.assertEqual(nested[1]["applicable_to"], ["b/file.py"])
            self.assertEqual(nested[2]["applicable_to"], ["a/deep/file.py"])
            self.assertEqual(payload["precedence"], ["global", "project_root", "nested"])

    def test_sharing_modes_distinguish_withheld_from_missing(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            codex_home = Path(codex_temp)
            (codex_home / "AGENTS.md").write_text("global body\n", encoding="utf-8")
            (workspace / "AGENTS.md").write_text("root body\n", encoding="utf-8")
            with patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}):
                context = load_project_context(workspace)

            off = context.applicable_instructions(["."], "off")
            metadata = context.applicable_instructions(["."], "metadata")
            content = context.applicable_instructions(["."], "content")
            self.assertEqual(off["files"], [])
            self.assertEqual(off["withheld"][0]["reason"], "sharing_mode_off")
            self.assertNotIn("content", metadata["files"][0])
            self.assertEqual(metadata["files"][0]["content_status"], "withheld")
            self.assertEqual(content["files"][0]["content"], "global body\n")

    def test_off_mode_hides_instruction_paths_from_server_info(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            (workspace / "AGENTS.md").write_text("root body\n", encoding="utf-8")
            with patch.dict(os.environ, {
                "CODEX_HOME": codex_temp,
                "CODING_TOOLS_MCP_INSTRUCTION_SHARING_MODE": "off",
            }):
                runtime = Runtime(workspace)
                info = runtime.server_info({})
                runtime.close()
            self.assertEqual(info["project_context"]["root_instruction_files"], [])
            self.assertIn("disabled", info["project_context"]["warnings"][0])

    def test_non_utf8_file_is_unavailable_not_missing(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            (workspace / "AGENTS.md").write_bytes(b"\xff\xfe")
            with patch.dict(os.environ, {"CODEX_HOME": codex_temp}):
                payload = load_project_context(workspace).applicable_instructions(["."], "metadata")
            root_missing = [item for item in payload["missing"] if item["scope"] == "project_root"]
            root_unavailable = [item for item in payload["unavailable"] if item["scope"] == "project_root"]
            self.assertEqual(root_missing, [])
            self.assertEqual(len(root_unavailable), 1)

    def test_nested_symlink_escape_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as outside_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            outside = Path(outside_temp) / "AGENTS.md"
            outside.write_text("outside\n", encoding="utf-8")
            (workspace / "nested").mkdir()
            (workspace / "nested" / "AGENTS.md").symlink_to(outside)
            with patch.dict(os.environ, {"CODEX_HOME": codex_temp}):
                payload = load_project_context(workspace).applicable_instructions(["nested/file.py"], "content")
            self.assertNotIn("outside\n", [item.get("content") for item in payload["files"]])
            self.assertTrue(any(item["scope"] == "nested" for item in payload["unavailable"]))

    def test_global_instructions_are_bounded_but_not_in_initialize_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            codex_home = Path(codex_temp)
            sentinel = "COMPLIANCE_SHOULD_NOT_LEAK"
            (codex_home / "AGENTS.md").write_text(sentinel + "g" * (MAX_GLOBAL_CONTEXT_BYTES + 32), encoding="utf-8")

            with patch.dict(os.environ, {
                "CODEX_HOME": str(codex_home),
                "CODING_TOOLS_MCP_INSTRUCTION_SHARING_MODE": "content",
                "CODING_TOOLS_MCP_TOOL_MODE": "smart",
            }):
                runtime = Runtime(workspace)
                initialized = runtime.initialize()
                workspace_payload = runtime.workspace_context({})
                discover = dispatch_rpc(runtime, {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "server/discover",
                    "params": {},
                })
                tool_result = runtime.call_tool("workspace_context", {})
                runtime.close()

            self.assertNotIn(sentinel, initialized["instructions"])
            self.assertNotIn(sentinel, str(discover["result"]))
            self.assertNotIn(sentinel, str(tool_result["content"]))
            self.assertIn("structuredContent.instructions", tool_result["content"][0]["text"])
            global_file = workspace_payload["instructions"]["files"][0]
            self.assertTrue(global_file["truncated"])
            self.assertEqual(global_file["loaded_bytes"], MAX_GLOBAL_CONTEXT_BYTES)
            self.assertIn(sentinel, global_file["content"])

    def test_runtime_refreshes_both_caches_after_modify_add_and_delete(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            root_rules = workspace / "AGENTS.md"
            root_rules.write_text("root one\n", encoding="utf-8")
            (workspace / "src").mkdir()
            (workspace / "src" / "app.py").write_text("VALUE = 1\n", encoding="utf-8")
            env = {
                "CODEX_HOME": codex_temp,
                "CODING_TOOLS_MCP_INSTRUCTION_SHARING_MODE": "content",
            }
            with patch.dict(os.environ, env):
                runtime = Runtime(workspace)
                first = runtime.workspace_context({"path": "src/app.py"})
                cached = runtime.workspace_context({"path": "src/app.py"})
                bundle = runtime.prepare_coding_context({"paths": ["src/app.py"]})
                bundle_cached = runtime.prepare_coding_context({"paths": ["src/app.py"]})
                root_rules.write_text("root two\n", encoding="utf-8")
                changed = runtime.workspace_context({"path": "src/app.py"})
                bundle_changed = runtime.prepare_coding_context({"paths": ["src/app.py"]})
                nested = workspace / "src" / "AGENTS.md"
                nested.write_text("nested rule\n", encoding="utf-8")
                added = runtime.workspace_context({"path": "src/app.py"})
                nested.unlink()
                deleted = runtime.workspace_context({"path": "src/app.py"})
                runtime.close()

            self.assertFalse(first["cache"]["hit"])
            self.assertTrue(cached["cache"]["hit"])
            self.assertFalse(bundle["cache_hit"])
            self.assertTrue(bundle_cached["cache_hit"])
            self.assertNotEqual(first["instructions"]["revision"], changed["instructions"]["revision"])
            self.assertFalse(changed["cache"]["hit"])
            self.assertFalse(bundle_changed["cache_hit"])
            self.assertIn("nested rule\n", [item.get("content") for item in added["instructions"]["files"]])
            self.assertNotIn("nested rule\n", [item.get("content") for item in deleted["instructions"]["files"]])

    def test_execute_phase_loads_rules_for_files_it_will_write(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_temp, tempfile.TemporaryDirectory() as codex_temp:
            workspace = Path(workspace_temp)
            (workspace / "src").mkdir()
            (workspace / "src" / "AGENTS.md").write_text("write scope rule\n", encoding="utf-8")
            with patch.dict(os.environ, {
                "CODEX_HOME": codex_temp,
                "CODING_TOOLS_MCP_INSTRUCTION_SHARING_MODE": "content",
            }):
                runtime = Runtime(workspace, permission_mode="dangerous")
                result = runtime.agent_workflow({
                    "workflow": "greenfield",
                    "phase": "execute",
                    "files": [{"path": "src/new.py", "content": "VALUE = 1\n"}],
                    "verification": "none",
                    "dry_run": True,
                    "include_diff": False,
                })
                runtime.close()
            self.assertIn("write scope rule\n", [
                item.get("content") for item in result["instructions"]["files"]
            ])


if __name__ == "__main__":
    unittest.main()
