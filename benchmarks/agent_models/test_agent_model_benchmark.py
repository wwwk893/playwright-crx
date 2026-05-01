import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from benchmarks.agent_models import agent_model_benchmark as bench


class AgentModelBenchmarkTests(unittest.TestCase):
    def test_extracts_business_prototype_text_from_zip_without_binary_noise(self):
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = Path(tmp) / "prototype.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("flows/address-pool.yaml", "title: 新建IPv4地址池\nWAN口: xtest16:WAN1\n")
                zf.writestr("src/page.tsx", "<ProFormSelect label=\"WAN口\" />")
                zf.writestr("assets/logo.png", b"\x89PNG\r\n\x1a\n\x00\x00binary")

            text = bench.extract_prototype_from_zip(zip_path, max_total_chars=4000)

        self.assertIn("新建IPv4地址池", text)
        self.assertIn("ProFormSelect", text)
        self.assertNotIn("binary", text)
        self.assertIn("# flows/address-pool.yaml", text)

    def test_context_ratio_keeps_priority_sections_and_shrinks_long_source(self):
        case = {
            "name": "sample",
            "business_goal": "录制地址池创建流程",
            "prototype": "A" * 4000,
            "expected": {},
        }

        compact = bench.build_case_context(case, context_ratio=0.25, max_context_chars=1000)
        full = bench.build_case_context(case, context_ratio=1.0, max_context_chars=1000)

        self.assertIn("录制地址池创建流程", compact)
        self.assertLessEqual(len(compact), 1200)
        self.assertGreater(len(full), len(compact))

    def test_scores_business_intent_entities_data_and_automation_risk(self):
        case = json.loads(Path(__file__).with_name("cases").joinpath("ipv4_address_pool.json").read_text())
        output = {
            "business_intent": "打开新建IPv4地址池弹窗，创建 IPv4 地址池，并选择 WAN口 后保存配置，用于循环批量构造地址池测试数据",
            "key_entities": ["地址池名称", "WAN口", "开始地址", "结束地址", "保存配置", "xtest16:WAN1"],
            "generated_test_data": [
                {"地址池名称": "pool-a", "WAN口": "xtest16:WAN1", "开始地址": "1.1.1.1", "结束地址": "2.2.2.2"},
                {"地址池名称": "pool-b", "WAN口": "xtest16:WAN2", "开始地址": "10.0.0.1", "结束地址": "10.0.0.20"},
                {"地址池名称": "pool-c", "WAN口": "xtest16:WAN3", "开始地址": "172.16.0.1", "结束地址": "172.16.0.30"},
            ],
            "automation_notes": "AntD ProFormSelect 的 WAN口 不要用动态 #rc_select，也不要只靠 combobox name；应点击 modal/form-item 内 .ant-select-selector，再选 dropdown option。",
        }

        score = bench.score_model_output(case, output)

        self.assertGreaterEqual(score["overall"], 0.85)
        self.assertEqual(score["checks"]["has_required_entities"], 1.0)
        self.assertEqual(score["checks"]["has_valid_batch_rows"], 1.0)
        self.assertEqual(score["checks"]["mentions_automation_risks"], 1.0)

    def test_builds_recorder_step_intent_and_repeat_data_prompt(self):
        case = json.loads(Path(__file__).with_name("cases").joinpath("recorder_intent_repeat.json").read_text())

        prompt = bench.build_prompt(case, context_ratio=0.6, max_context_chars=5000)

        self.assertIn("每一步点击/输入前后局部上下文", prompt)
        self.assertIn("repeat_segment", prompt)
        self.assertIn("s004", prompt)
        self.assertIn("xtest16:WAN1", prompt)
        self.assertIn("repeat_data", prompt)

    def test_scores_recorder_step_intents_and_repeat_data(self):
        case = json.loads(Path(__file__).with_name("cases").joinpath("recorder_intent_repeat.json").read_text())
        output = {
            "items": [
                {"stepId": "s001", "intent": "打开新建IPv4地址池弹窗", "confidence": 0.98},
                {"stepId": "s002", "intent": "填写地址池名称", "confidence": 0.98},
                {"stepId": "s003", "intent": "打开WAN口下拉选择器", "confidence": 0.95},
                {"stepId": "s004", "intent": "选择WAN口为xtest16:WAN1", "confidence": 0.98},
                {"stepId": "s005", "intent": "填写开始地址", "confidence": 0.98},
                {"stepId": "s006", "intent": "填写结束地址", "confidence": 0.98},
                {"stepId": "s007", "intent": "确认添加地址池", "confidence": 0.96},
                {"stepId": "s008", "intent": "保存配置", "confidence": 0.98},
            ],
            "repeat_data": [
                {"poolName": "pool-a", "wanPort": "xtest16:WAN1", "startIp": "1.1.1.1", "endIp": "1.1.1.254"},
                {"poolName": "pool-b", "wanPort": "xtest16:WAN1", "startIp": "10.0.0.1", "endIp": "10.0.0.254"},
                {"poolName": "pool-c", "wanPort": "xtest16:WAN1", "startIp": "172.16.0.1", "endIp": "172.16.0.254"},
            ],
            "automation_notes": "AntD ProFormSelect 的 WAN口 不能依赖 combobox 或动态 rc_select，应该点 .ant-select-selector。",
        }

        score = bench.score_model_output(case, output)

        self.assertGreaterEqual(score["overall"], 0.9)
        self.assertEqual(score["checks"]["step_intent_accuracy"], 1.0)
        self.assertEqual(score["checks"]["has_valid_repeat_data"], 1.0)
        self.assertEqual(score["checks"]["mentions_automation_risks"], 1.0)

    def test_redacts_api_keys_in_captured_output(self):
        raw = "failed with sk-1234567890abcdef and sk-ant-api03-very-secret"
        redacted = bench.redact_secrets(raw)
        self.assertNotIn("1234567890abcdef", redacted)
        self.assertIn("[REDACTED_API_KEY]", redacted)

    def test_loads_provider_keys_from_env_file_without_overwriting_existing_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("DEEPSEEK_API_KEY=sk-local-test-value\nEXISTING_KEY=from_file\n")
            old_deepseek = bench.os.environ.pop("DEEPSEEK_API_KEY", None)
            old_existing = bench.os.environ.get("EXISTING_KEY")
            bench.os.environ["EXISTING_KEY"] = "keep_me"
            try:
                bench.load_env_file(env_path)
                self.assertEqual(bench.os.environ.get("DEEPSEEK_API_KEY"), "sk-local-test-value")
                self.assertEqual(bench.os.environ.get("EXISTING_KEY"), "keep_me")
            finally:
                if old_deepseek is None:
                    bench.os.environ.pop("DEEPSEEK_API_KEY", None)
                else:
                    bench.os.environ["DEEPSEEK_API_KEY"] = old_deepseek
                if old_existing is None:
                    bench.os.environ.pop("EXISTING_KEY", None)
                else:
                    bench.os.environ["EXISTING_KEY"] = old_existing

    def test_model_catalog_includes_prices_and_requested_variants(self):
        self.assertEqual(bench.DEFAULT_MODELS["gpt-5.4-mini"]["model"], "gpt-5.4-mini")
        self.assertEqual(bench.DEFAULT_MODELS["gpt-5.4-mini"]["pricing_source"], "openai-codex-subscription")
        for model_id in [
            "deepseek-v4-flash-no-thinking",
            "deepseek-v4-flash-thinking-low",
            "deepseek-v4-flash-thinking-medium",
            "deepseek-v4-flash-thinking-high",
            "deepseek-v4-flash-thinking-max",
            "deepseek-v4-pro-no-thinking",
            "deepseek-v4-pro-thinking-low",
            "deepseek-v4-pro-thinking-medium",
            "deepseek-v4-pro-thinking-high",
            "deepseek-v4-pro-thinking-max",
        ]:
            self.assertIn(model_id, bench.DEFAULT_MODELS)
            self.assertIn("pricing_source", bench.DEFAULT_MODELS[model_id])
            self.assertGreater(bench.DEFAULT_MODELS[model_id]["output_usd_per_1m"], 0)

    def test_summarizes_multiple_cases_and_cost_source(self):
        runs = [
            bench.ModelRun(model_id="gpt-5.4-mini", case_name="case-a", context_ratio=1.0, ok=True, elapsed_seconds=10, prompt_chars=100, output_chars=50, estimated_prompt_tokens=30, estimated_output_tokens=20, estimated_cost_usd=0.0, pricing_source="openai-codex-subscription", score={"overall": 0.8}),
            bench.ModelRun(model_id="deepseek-v4-pro-thinking-max", case_name="case-b", context_ratio=1.0, ok=True, elapsed_seconds=20, prompt_chars=100, output_chars=50, estimated_prompt_tokens=30, estimated_output_tokens=20, estimated_cost_usd=0.0001, pricing_source="deepseek-official-cache-miss", score={"overall": 0.6}),
        ]
        summary = bench.summarize_results(runs)
        self.assertIn("by_case", summary)
        self.assertEqual(summary["by_case"]["case-a"]["best"]["model_id"], "gpt-5.4-mini")
        self.assertEqual(summary["ranked"][0]["pricing_source"], "openai-codex-subscription")


if __name__ == "__main__":
    unittest.main()
