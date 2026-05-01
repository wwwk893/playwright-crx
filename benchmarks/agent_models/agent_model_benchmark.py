#!/usr/bin/env python3
"""Benchmark business-intent understanding for agent models.

This harness is intentionally lightweight: it uses only Python stdlib and shells out to
Hermes CLI so GPT/Kimi/DeepSeek can use the user's existing Hermes subscriptions/config.
Secrets are never printed; model output and errors are redacted before saving.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

TEXT_EXTENSIONS = {
    ".md",
    ".markdown",
    ".txt",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".html",
    ".css",
    ".csv",
    ".xml",
}

DEFAULT_MODELS = {
    "gpt-5.4-mini": {
        "provider": "openai-codex",
        "model": "gpt-5.4-mini",
        "transport": "hermes",
        "input_usd_per_1m": 0.0,
        "output_usd_per_1m": 0.0,
        "pricing_source": "openai-codex-subscription",
        "cost_note": "Uses the user's OpenAI Codex subscription; marginal per-run token cost is tracked as $0.00, subscription fee is not allocated.",
        "notes": "Requested GPT baseline. Smoke-tested via Hermes openai-codex provider.",
    },
    "gpt-codex": {
        "provider": "openai-codex",
        "model": "gpt-5.4-mini",
        "transport": "hermes",
        "input_usd_per_1m": 0.0,
        "output_usd_per_1m": 0.0,
        "pricing_source": "openai-codex-subscription",
        "cost_note": "Compatibility alias for gpt-5.4-mini using the user's Codex subscription.",
        "notes": "Backward-compatible benchmark id.",
    },
    "kimi-k2.5": {
        "provider": "kimi-coding",
        "model": "kimi-k2.5",
        "transport": "hermes",
        "input_usd_per_1m": 0.50,
        "output_usd_per_1m": 2.80,
        "pricing_source": "openrouter-market-reference",
        "cost_note": "Estimated with public market reference pricing; actual Hermes/Kimi provider billing may differ.",
        "notes": "Uses KIMI_API_KEY via Hermes provider kimi-coding. K2.5 is the smoke-tested fallback if K2.6 404s.",
    },
    "deepseek-v4-flash-no-thinking": {
        "model": "deepseek-v4-flash",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "disabled"},
        "input_usd_per_1m": 0.14,
        "input_cache_hit_usd_per_1m": 0.0028,
        "output_usd_per_1m": 0.28,
        "pricing_source": "deepseek-official-cache-miss",
        "cost_note": "Conservative official DeepSeek V4 Flash cache-miss input pricing; cache hits may be cheaper.",
        "notes": "DeepSeek V4 Flash non-thinking mode.",
    },
    "deepseek-v4-flash-thinking-low": {
        "model": "deepseek-v4-flash",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "low",
        "input_usd_per_1m": 0.14,
        "input_cache_hit_usd_per_1m": 0.0028,
        "output_usd_per_1m": 0.28,
        "pricing_source": "deepseek-official-cache-miss",
        "cost_note": "Conservative official DeepSeek V4 Flash cache-miss pricing; low maps to high per official docs.",
        "notes": "deepseek-v4-flash thinking mode, low effort. DeepSeek maps low/medium to high per official docs.",
    },
    "deepseek-v4-flash-thinking-medium": {
        "model": "deepseek-v4-flash",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "medium",
        "input_usd_per_1m": 0.14,
        "input_cache_hit_usd_per_1m": 0.0028,
        "output_usd_per_1m": 0.28,
        "pricing_source": "deepseek-official-cache-miss",
        "cost_note": "Conservative official DeepSeek V4 Flash cache-miss pricing; medium maps to high per official docs.",
        "notes": "deepseek-v4-flash thinking mode, medium effort. DeepSeek maps low/medium to high per official docs.",
    },
    "deepseek-v4-flash-thinking-high": {
        "model": "deepseek-v4-flash",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high",
        "input_usd_per_1m": 0.14,
        "input_cache_hit_usd_per_1m": 0.0028,
        "output_usd_per_1m": 0.28,
        "pricing_source": "deepseek-official-cache-miss",
        "cost_note": "Conservative official DeepSeek V4 Flash cache-miss input pricing; includes final output tokens returned by API usage when available.",
        "notes": "DeepSeek V4 Flash thinking mode, high effort.",
    },
    "deepseek-v4-flash-thinking-max": {
        "model": "deepseek-v4-flash",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "max",
        "input_usd_per_1m": 0.14,
        "input_cache_hit_usd_per_1m": 0.0028,
        "output_usd_per_1m": 0.28,
        "pricing_source": "deepseek-official-cache-miss",
        "cost_note": "Conservative official DeepSeek V4 Flash cache-miss input pricing; max reasoning effort.",
        "notes": "DeepSeek V4 Flash thinking mode, max effort.",
    },
    "deepseek-v4-pro-no-thinking": {
        "model": "deepseek-v4-pro",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "disabled"},
        "input_usd_per_1m": 0.435,
        "input_cache_hit_usd_per_1m": 0.003625,
        "output_usd_per_1m": 0.87,
        "pricing_source": "deepseek-official-discount-cache-miss",
        "cost_note": "Official DeepSeek V4 Pro discounted cache-miss pricing through 2026-05-31; cache hits may be cheaper.",
        "notes": "DeepSeek V4 Pro non-thinking mode.",
    },
    "deepseek-v4-pro-thinking-low": {
        "model": "deepseek-v4-pro",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "low",
        "input_usd_per_1m": 0.435,
        "input_cache_hit_usd_per_1m": 0.003625,
        "output_usd_per_1m": 0.87,
        "pricing_source": "deepseek-official-discount-cache-miss",
        "cost_note": "Official DeepSeek V4 Pro discounted cache-miss pricing through 2026-05-31; low maps to high per official docs.",
        "notes": "deepseek-v4-pro thinking mode, low effort. DeepSeek maps low/medium to high per official docs.",
    },
    "deepseek-v4-pro-thinking-medium": {
        "model": "deepseek-v4-pro",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "medium",
        "input_usd_per_1m": 0.435,
        "input_cache_hit_usd_per_1m": 0.003625,
        "output_usd_per_1m": 0.87,
        "pricing_source": "deepseek-official-discount-cache-miss",
        "cost_note": "Official DeepSeek V4 Pro discounted cache-miss pricing through 2026-05-31; medium maps to high per official docs.",
        "notes": "deepseek-v4-pro thinking mode, medium effort. DeepSeek maps low/medium to high per official docs.",
    },
    "deepseek-v4-pro-thinking-high": {
        "model": "deepseek-v4-pro",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high",
        "input_usd_per_1m": 0.435,
        "input_cache_hit_usd_per_1m": 0.003625,
        "output_usd_per_1m": 0.87,
        "pricing_source": "deepseek-official-discount-cache-miss",
        "cost_note": "Official DeepSeek V4 Pro discounted cache-miss pricing through 2026-05-31; thinking high effort.",
        "notes": "DeepSeek V4 Pro thinking mode, high effort.",
    },
    "deepseek-v4-pro-thinking-max": {
        "model": "deepseek-v4-pro",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "enabled"},
        "reasoning_effort": "max",
        "input_usd_per_1m": 0.435,
        "input_cache_hit_usd_per_1m": 0.003625,
        "output_usd_per_1m": 0.87,
        "pricing_source": "deepseek-official-discount-cache-miss",
        "cost_note": "Official DeepSeek V4 Pro discounted cache-miss pricing through 2026-05-31; max reasoning effort.",
        "notes": "DeepSeek V4 Pro thinking mode, max effort.",
    },
    "deepseek-v4-flash": {
        "alias_for": "deepseek-v4-flash-no-thinking",
        "model": "deepseek-v4-flash",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "disabled"},
        "input_usd_per_1m": 0.14,
        "input_cache_hit_usd_per_1m": 0.0028,
        "output_usd_per_1m": 0.28,
        "pricing_source": "deepseek-official-cache-miss",
        "cost_note": "Compatibility alias for DeepSeek V4 Flash non-thinking mode.",
        "notes": "Compatibility alias.",
    },
    "deepseek-chat": {
        "alias_for": "deepseek-v4-flash-no-thinking",
        "model": "deepseek-v4-flash",
        "transport": "openai-compatible",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_key_env": "DEEPSEEK_API_KEY",
        "thinking": {"type": "disabled"},
        "input_usd_per_1m": 0.14,
        "input_cache_hit_usd_per_1m": 0.0028,
        "output_usd_per_1m": 0.28,
        "pricing_source": "deepseek-official-cache-miss",
        "cost_note": "Legacy compatibility alias; DeepSeek maps deepseek-chat to V4 Flash non-thinking.",
        "notes": "Legacy compatibility alias.",
    },
}

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9][A-Za-z0-9_\-]{12,}"),
    re.compile(r"sk-ant-api03-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"(?i)(api[_-]?key|authorization|bearer|token|secret)\s*[:=]\s*['\"]?[^\s,'\"]+"),
]


@dataclass
class ModelRun:
    model_id: str
    case_name: str
    context_ratio: float
    ok: bool
    elapsed_seconds: float
    prompt_chars: int
    output_chars: int
    estimated_prompt_tokens: int
    estimated_output_tokens: int
    estimated_cost_usd: float
    pricing_source: str
    cost_note: str = ""
    provider_usage: dict[str, Any] | None = None
    score: dict[str, Any] | None = None
    parsed_output: dict[str, Any] | None = None
    raw_output: str | None = None
    error: str | None = None


def redact_secrets(text: str) -> str:
    redacted = text or ""
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED_API_KEY]", redacted)
    return redacted


def load_env_file(path: str | Path) -> None:
    """Load KEY=VALUE pairs without printing them, preserving existing env vars."""
    env_path = Path(path).expanduser()
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('\"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def estimate_tokens(text: str) -> int:
    # Conservative mixed Chinese/English approximation for benchmark cost comparison.
    return max(1, math.ceil(len(text) / 3.2))


def _is_probably_text(name: str) -> bool:
    return Path(name).suffix.lower() in TEXT_EXTENSIONS


def extract_prototype_from_zip(zip_path: str | Path, max_total_chars: int = 60_000, per_file_chars: int = 12_000) -> str:
    """Extract readable business prototype snippets from a zip.

    Binary files and dependency/vendor folders are ignored. Output is bounded so it can
    be tested at different context ratios without accidentally dumping huge archives.
    """
    zip_path = Path(zip_path)
    chunks: list[str] = []
    used = 0
    ignored_dirs = ("node_modules/", "dist/", "build/", ".git/", "__MACOSX/")
    with zipfile.ZipFile(zip_path) as zf:
        names = sorted(zf.namelist())
        for name in names:
            normalized = name.replace("\\", "/")
            if normalized.endswith("/") or any(part in normalized for part in ignored_dirs):
                continue
            if not _is_probably_text(normalized):
                continue
            if used >= max_total_chars:
                break
            raw = zf.read(name)[: per_file_chars * 4]
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                try:
                    text = raw.decode("utf-8", errors="ignore")
                except Exception:
                    continue
            text = text.replace("\x00", "").strip()
            if not text:
                continue
            remaining = max_total_chars - used
            snippet = text[: min(per_file_chars, remaining)]
            chunks.append(f"# {normalized}\n{snippet}")
            used += len(snippet)
    return redact_secrets("\n\n".join(chunks))


def load_case(case_path: str | Path, prototype_zip: str | Path | None = None) -> dict[str, Any]:
    case = json.loads(Path(case_path).read_text(encoding="utf-8"))
    if prototype_zip:
        extracted = extract_prototype_from_zip(prototype_zip)
        case = dict(case)
        case["prototype"] = extracted or case.get("prototype", "")
        case["prototype_source"] = str(prototype_zip)
    return case


def _truncate_middle(text: str, target_chars: int) -> str:
    if len(text) <= target_chars:
        return text
    if target_chars <= 120:
        return text[:target_chars]
    head = int(target_chars * 0.65)
    tail = target_chars - head - 80
    return text[:head] + "\n\n...[中间内容按上下文比例裁剪]...\n\n" + text[-max(0, tail) :]


def build_case_context(case: dict[str, Any], context_ratio: float, max_context_chars: int = 24_000) -> str:
    ratio = min(1.0, max(0.05, float(context_ratio)))
    budget = max(800, int(max_context_chars * ratio))
    goal = case.get("business_goal") or case.get("title") or case.get("name", "")
    expected = case.get("expected", {})
    header = textwrap.dedent(
        f"""
        ## Benchmark Case
        name: {case.get('name', 'unnamed')}
        title: {case.get('title', '')}
        task_type: {case.get('task_type', 'prototype_intent_and_data')}
        business_goal: {goal}
        """
    ).strip()

    if case.get("task_type") == "recorder_intent_and_repeat_data":
        body = json.dumps({
            "ai_intent_input": case.get("ai_intent_input", {}),
            "repeat_segment": case.get("repeat_segment", {}),
            "evaluation_hints": {
                "expected_step_ids": list((expected.get("step_intents") or {}).keys()),
                "repeat_data_fields": expected.get("repeat_data_fields", []),
                "required_option_values": expected.get("required_option_values", []),
            },
        }, ensure_ascii=False, indent=2)
    else:
        body = textwrap.dedent(
            f"""
            ## Evaluation Hints
            required_entities: {', '.join(expected.get('required_entities', []))}
            required_data_fields: {', '.join(expected.get('required_data_fields', []))}
            required_option_values: {', '.join(expected.get('required_option_values', []))}

            ## Prototype Source
            {case.get('prototype', '')}
            """
        ).strip()

    body_budget = max(200, budget - len(header) - 20)
    return f"{header}\n{_truncate_middle(str(body), body_budget)}"[: budget + 200]


def build_prompt(case: dict[str, Any], context_ratio: float, max_context_chars: int) -> str:
    context = build_case_context(case, context_ratio, max_context_chars=max_context_chars)
    if case.get("task_type") == "recorder_intent_and_repeat_data":
        return textwrap.dedent(
            f"""
            你是浏览器录制器里的 AI 业务意图助手。请根据 recorder 给你的每一步点击/输入前后局部上下文，
            判断每个 step 的业务意图；同时根据用户选中的 repeat_segment 中间步骤，生成可用于循环执行的批量测试数据。
            要求：
            - intent 是业务含义，不要复述 selector/testId/完整 URL。
            - repeat_data 只给被选中循环片段需要参数化的字段，字段名使用 repeat_segment.parameters.variableName。
            - 至少生成 3 行 repeat_data，名称和 IP 段不能重复。
            - 如果涉及 AntD / ProComponents / ProFormSelect，要指出 replay/selector 风险。
            - 输出严格 JSON，不要 Markdown。

            JSON schema:
            {{
              "items": [{{ "stepId": "s001", "intent": "业务意图", "confidence": 0.0, "reason": "简短原因" }}],
              "repeat_data": [{{ "poolName": "...", "wanPort": "...", "startIp": "...", "endIp": "..." }}],
              "automation_notes": "录制、回放、selector、循环数据注意点"
            }}

            {context}
            """
        ).strip()

    return textwrap.dedent(
        f"""
        你是一个评测中的 coding agent。请只基于下面的业务原型上下文，判断用户真正想自动化的业务意图，
        并生成可用于批量循环 E2E / replay 的测试数据。要求：
        - 不要编造密钥、账号、真实客户信息；如果上下文里出现敏感信息，用 [REDACTED]。
        - 如果是 AntD / ProComponents / Chrome extension recorder 场景，要指出 selector/replay 风险。
        - 输出必须是严格 JSON，不要 Markdown，不要解释。

        JSON schema:
        {{
          "business_intent": "一句话描述业务意图",
          "key_entities": ["实体/字段/按钮/选项"],
          "generated_test_data": [{{"字段": "值"}}],
          "automation_notes": "对录制、回放、selector、批量循环的注意点",
          "confidence": 0.0
        }}

        {context}
        """
    ).strip()


def _flatten_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return " ".join(f"{k} {_flatten_text(v)}" for k, v in value.items())
    if isinstance(value, list):
        return " ".join(_flatten_text(v) for v in value)
    return str(value)


def parse_json_from_output(output: str) -> dict[str, Any]:
    text = output.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _normalize_for_match(text: str) -> str:
    return re.sub(r"\s+", "", str(text).lower())


def _contains_all(haystack: str, needles: Iterable[str]) -> float:
    needles = [n for n in needles if n]
    if not needles:
        return 1.0
    normalized_haystack = _normalize_for_match(haystack)
    hits = sum(1 for n in needles if _normalize_for_match(n) in normalized_haystack)
    return hits / len(needles)


def _valid_ip(value: str) -> bool:
    parts = str(value).split(".")
    if len(parts) != 4:
        return False
    try:
        return all(0 <= int(p) <= 255 for p in parts)
    except ValueError:
        return False


def _data_rows_from_output(output: dict[str, Any]) -> list[Any]:
    rows = output.get("repeat_data") if "repeat_data" in output else output.get("generated_test_data")
    return rows if isinstance(rows, list) else []


def _score_repeat_rows(expected: dict[str, Any], rows: list[Any]) -> float:
    required_fields = expected.get("repeat_data_fields") or expected.get("required_data_fields", [])
    valid_rows = 0
    unique_signatures = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_text = _flatten_text(row)
        has_fields = all(field in row or any(field in str(k) or field in str(v) for k, v in row.items()) or field in row_text for field in required_fields)
        ip_values = [str(v) for v in row.values() if _valid_ip(str(v))]
        has_ip_range = len(ip_values) >= 2 if any("ip" in f.lower() or "地址" in f for f in required_fields) else True
        if has_fields and has_ip_range:
            valid_rows += 1
            unique_signatures.add(json.dumps(row, ensure_ascii=False, sort_keys=True))
    row_count_score = min(1.0, len(rows) / 3) if rows else 0.0
    row_validity_score = min(1.0, valid_rows / max(1, min(3, len(rows)))) if rows else 0.0
    uniqueness_score = min(1.0, len(unique_signatures) / max(1, min(3, len(rows)))) if rows else 0.0
    return row_count_score * 0.25 + row_validity_score * 0.55 + uniqueness_score * 0.20


def _score_step_intents(expected: dict[str, Any], output: dict[str, Any]) -> float:
    expected_intents = expected.get("step_intents") or {}
    if not expected_intents:
        return 0.0
    items = output.get("items")
    if not isinstance(items, list):
        return 0.0
    by_step = {str(item.get("stepId")): str(item.get("intent", "")) for item in items if isinstance(item, dict)}
    if not by_step:
        return 0.0
    scores = []
    for step_id, keywords in expected_intents.items():
        scores.append(_contains_all(by_step.get(step_id, ""), keywords))
    return sum(scores) / len(scores)


def score_model_output(case: dict[str, Any], output: dict[str, Any]) -> dict[str, Any]:
    expected = case.get("expected", {})
    all_text = _flatten_text(output)
    option_score = _contains_all(all_text, expected.get("required_option_values", []))
    risk_score = min(1.0, _contains_all(all_text, expected.get("automation_risk_keywords", [])) * 1.25)

    if case.get("task_type") == "recorder_intent_and_repeat_data":
        step_intent_score = _score_step_intents(expected, output)
        data_score = _score_repeat_rows(expected, _data_rows_from_output(output))
        checks = {
            "step_intent_accuracy": round(step_intent_score, 3),
            "has_required_option_values": round(option_score, 3),
            "has_valid_repeat_data": round(data_score, 3),
            "mentions_automation_risks": round(risk_score, 3),
        }
        overall = step_intent_score * 0.45 + data_score * 0.35 + option_score * 0.05 + risk_score * 0.15
        return {"overall": round(overall, 3), "checks": checks}

    intent = str(output.get("business_intent", ""))
    intent_score = _contains_all(intent + " " + all_text, expected.get("intent_keywords", []))
    entity_score = _contains_all(all_text, expected.get("required_entities", []))
    data_score = _score_repeat_rows(expected, _data_rows_from_output(output))

    checks = {
        "understands_intent": round(intent_score, 3),
        "has_required_entities": round(entity_score, 3),
        "has_required_option_values": round(option_score, 3),
        "has_valid_batch_rows": round(data_score, 3),
        "mentions_automation_risks": round(risk_score, 3),
    }
    overall = (
        intent_score * 0.25
        + entity_score * 0.20
        + option_score * 0.10
        + data_score * 0.30
        + risk_score * 0.15
    )
    return {"overall": round(overall, 3), "checks": checks}


def model_cost(model_cfg: dict[str, Any], prompt_tokens: int, output_tokens: int, usage: dict[str, Any] | None = None) -> float:
    if usage:
        prompt_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or prompt_tokens)
        output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or output_tokens)
    return round(
        prompt_tokens * float(model_cfg.get("input_usd_per_1m", 0.0)) / 1_000_000
        + output_tokens * float(model_cfg.get("output_usd_per_1m", 0.0)) / 1_000_000,
        6,
    )


def call_model_with_hermes(model_cfg: dict[str, Any], prompt: str, timeout: int = 300) -> tuple[str, dict[str, Any] | None]:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".prompt.txt", delete=False) as f:
        f.write(prompt)
        prompt_path = f.name
    try:
        cmd = [
            "hermes",
            "chat",
            "-Q",
            "--provider",
            model_cfg["provider"],
            "-m",
            model_cfg["model"],
            "-t",
            "",
            "--max-turns",
            "1",
            "-q",
            f"$(cat {prompt_path})",
        ]
        # Avoid shell interpolation surprises by using bash only to feed the prompt file.
        shell_cmd = " ".join(subprocess.list2cmdline([part]) for part in cmd[:-1]) + " " + subprocess.list2cmdline([f"$(cat {prompt_path})"])
        proc = subprocess.run(
            ["bash", "-lc", shell_cmd],
            text=True,
            capture_output=True,
            timeout=timeout,
            env=os.environ.copy(),
        )
        output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        if proc.returncode != 0:
            raise RuntimeError(redact_secrets(output.strip() or f"hermes exited with {proc.returncode}"))
        return redact_secrets(proc.stdout.strip()), None
    finally:
        try:
            os.unlink(prompt_path)
        except OSError:
            pass


def call_model_openai_compatible(model_cfg: dict[str, Any], prompt: str, timeout: int = 300) -> tuple[str, dict[str, Any] | None]:
    key_name = model_cfg.get("api_key_env")
    api_key = os.environ.get(str(key_name)) if key_name else None
    if not api_key:
        raise RuntimeError(f"Missing required environment variable: {key_name}")
    payload = {
        "model": model_cfg["model"],
        "messages": [
            {"role": "system", "content": "You are a precise benchmarked coding agent. Return strict JSON only."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 1800,
        "response_format": {"type": "json_object"},
    }
    if model_cfg.get("thinking", {}).get("type") != "enabled":
        payload["temperature"] = 0.2
    if "thinking" in model_cfg:
        payload["thinking"] = model_cfg["thinking"]
    if "reasoning_effort" in model_cfg:
        payload["reasoning_effort"] = model_cfg["reasoning_effort"]

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as body_file:
        json.dump(payload, body_file, ensure_ascii=False)
        body_path = body_file.name
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".curlrc", delete=False) as cfg_file:
        cfg_file.write(f"url = \"{model_cfg['base_url']}\"\n")
        cfg_file.write("request = \"POST\"\n")
        cfg_file.write("header = \"Content-Type: application/json\"\n")
        cfg_file.write(f"header = \"Authorization: Bearer {api_key}\"\n")
        cfg_file.write(f"data = @{body_path}\n")
        cfg_path = cfg_file.name
    try:
        proc = subprocess.run(
            ["curl", "--silent", "--show-error", "--max-time", str(timeout), "--config", cfg_path],
            text=True,
            capture_output=True,
            timeout=timeout + 10,
        )
        body = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        if proc.returncode != 0:
            raise RuntimeError(redact_secrets(f"curl exited {proc.returncode}: {body[:1000]}"))
        parsed = json.loads(proc.stdout)
    finally:
        for path in (body_path, cfg_path):
            try:
                os.unlink(path)
            except OSError:
                pass
    try:
        content = parsed["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(redact_secrets(f"Unexpected API response: {json.dumps(parsed, ensure_ascii=False)[:1000]}")) from exc
    return redact_secrets(str(content).strip()), parsed.get("usage") if isinstance(parsed, dict) else None


def call_model(model_cfg: dict[str, Any], prompt: str, timeout: int = 300) -> tuple[str, dict[str, Any] | None]:
    transport = model_cfg.get("transport", "hermes")
    if transport == "hermes":
        return call_model_with_hermes(model_cfg, prompt, timeout=timeout)
    if transport == "openai-compatible":
        return call_model_openai_compatible(model_cfg, prompt, timeout=timeout)
    raise RuntimeError(f"Unsupported transport: {transport}")


def run_one_model(case: dict[str, Any], model_id: str, model_cfg: dict[str, Any], context_ratio: float, args: argparse.Namespace) -> ModelRun:
    prompt = build_prompt(case, context_ratio, max_context_chars=args.max_context_chars)
    prompt_tokens = estimate_tokens(prompt)
    start = time.perf_counter()
    usage = None
    if args.dry_run:
        output = json.dumps(
            {
                "business_intent": "DRY_RUN: would infer business intent here",
                "key_entities": [],
                "generated_test_data": [],
                "automation_notes": "DRY_RUN",
                "confidence": 0.0,
            },
            ensure_ascii=False,
        )
    else:
        output, usage = call_model(model_cfg, prompt, timeout=args.timeout)
    elapsed = time.perf_counter() - start
    if args.dry_run:
        usage = None
    output_tokens = estimate_tokens(output)
    base = {
        "model_id": model_id,
        "case_name": case.get("name", "unnamed"),
        "context_ratio": context_ratio,
        "elapsed_seconds": round(elapsed, 3),
        "prompt_chars": len(prompt),
        "output_chars": len(output),
        "estimated_prompt_tokens": prompt_tokens,
        "estimated_output_tokens": output_tokens,
        "estimated_cost_usd": model_cost(model_cfg, prompt_tokens, output_tokens, usage),
        "pricing_source": str(model_cfg.get("pricing_source", "unknown")),
        "cost_note": str(model_cfg.get("cost_note", "")),
        "provider_usage": usage,
    }
    try:
        parsed = parse_json_from_output(output)
        score = score_model_output(case, parsed) if not args.dry_run else {"overall": None, "checks": {}}
        return ModelRun(ok=True, parsed_output=parsed, raw_output=None if args.no_raw else output, score=score, **base)
    except Exception as exc:
        return ModelRun(ok=False, raw_output=None if args.no_raw else redact_secrets(output), error=redact_secrets(str(exc)), **base)


def summarize_results(runs: list[ModelRun]) -> dict[str, Any]:
    ranked = []
    for run in runs:
        accuracy = (run.score or {}).get("overall")
        if accuracy is None:
            accuracy = 0.0
        speed_score = 1.0 / max(0.5, run.elapsed_seconds)
        cost_penalty = run.estimated_cost_usd
        composite = round(float(accuracy) * 0.70 + min(1.0, speed_score) * 0.20 - min(0.2, cost_penalty) * 0.10, 3)
        ranked.append(
            {
                "case_name": run.case_name,
                "model_id": run.model_id,
                "context_ratio": run.context_ratio,
                "accuracy": accuracy,
                "elapsed_seconds": run.elapsed_seconds,
                "estimated_cost_usd": run.estimated_cost_usd,
                "pricing_source": run.pricing_source,
                "cost_note": run.cost_note,
                "composite": composite,
                "ok": run.ok,
            }
        )
    ranked.sort(key=lambda item: item["composite"], reverse=True)
    by_case: dict[str, dict[str, Any]] = {}
    for case_name in sorted({item["case_name"] for item in ranked}):
        case_ranked = [item for item in ranked if item["case_name"] == case_name]
        by_case[case_name] = {"ranked": case_ranked, "best": case_ranked[0] if case_ranked else None}
    return {"ranked": ranked, "best": ranked[0] if ranked else None, "by_case": by_case}


def parse_ratios(value: str) -> list[float]:
    return [float(part.strip()) for part in value.split(",") if part.strip()]


def parse_models(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def parse_case_paths(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run agent model benchmark for business prototype understanding.")
    parser.add_argument("--case", default=str(Path(__file__).with_name("cases") / "ipv4_address_pool.json"), help="Single benchmark case path. Ignored when --cases is provided.")
    parser.add_argument("--cases", help="Comma-separated benchmark case paths for multi-case runs.")
    parser.add_argument("--prototype-zip", help="Optional user-uploaded business prototype zip. Text files inside override case.prototype for single-case runs.")
    parser.add_argument("--models", default="gpt-5.4-mini,kimi-k2.5,deepseek-v4-flash-no-thinking")
    parser.add_argument("--context-ratios", default="0.35,0.6,1.0")
    parser.add_argument("--max-context-chars", type=int, default=24_000)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--env-file", default="~/.hermes/.env", help="Optional local env file for provider keys; values are not printed.")
    parser.add_argument("--dry-run", action="store_true", help="Render prompts and scoring envelope without calling models.")
    parser.add_argument("--no-raw", action="store_true", help="Do not store raw model output in results.")
    parser.add_argument("--output", default=str(Path(__file__).with_name("results") / "latest.json"))
    args = parser.parse_args(argv)

    if args.env_file:
        load_env_file(args.env_file)
    socket.setdefaulttimeout(args.timeout)

    case_paths = parse_case_paths(args.cases) if args.cases else [args.case]
    cases = [load_case(path, args.prototype_zip if len(case_paths) == 1 else None) for path in case_paths]
    model_ids = parse_models(args.models)
    ratios = parse_ratios(args.context_ratios)

    runs: list[ModelRun] = []
    for case in cases:
        for model_id in model_ids:
            if model_id not in DEFAULT_MODELS:
                print(f"Unknown model id: {model_id}", file=sys.stderr)
                return 2
            for ratio in ratios:
                print(f"[benchmark] case={case.get('name', 'unnamed')} model={model_id} context={ratio}", file=sys.stderr, flush=True)
                try:
                    runs.append(run_one_model(case, model_id, DEFAULT_MODELS[model_id], ratio, args))
                except Exception as exc:
                    prompt = build_prompt(case, ratio, args.max_context_chars)
                    runs.append(
                        ModelRun(
                            model_id=model_id,
                            case_name=case.get("name", "unnamed"),
                            context_ratio=ratio,
                            ok=False,
                            elapsed_seconds=0.0,
                            prompt_chars=len(prompt),
                            output_chars=0,
                            estimated_prompt_tokens=estimate_tokens(prompt),
                            estimated_output_tokens=0,
                            estimated_cost_usd=0.0,
                            pricing_source=str(DEFAULT_MODELS[model_id].get("pricing_source", "unknown")),
                            cost_note=str(DEFAULT_MODELS[model_id].get("cost_note", "")),
                            error=redact_secrets(str(exc)),
                        )
                    )

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cases": [{"name": case.get("name"), "title": case.get("title"), "prototype_source": case.get("prototype_source")} for case in cases],
        "dry_run": args.dry_run,
        "models": {k: {kk: vv for kk, vv in v.items() if kk not in {"api_key"}} for k, v in DEFAULT_MODELS.items() if k in model_ids},
        "runs": [run.__dict__ for run in runs],
        "summary": summarize_results(runs),
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(out_path), "summary": payload["summary"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
