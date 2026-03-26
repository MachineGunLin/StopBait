from __future__ import annotations

import time
from typing import Optional

import httpx


class GeminiError(RuntimeError):
    pass


def normalize_gemini_model(model: str) -> str:
    raw = (model or "").strip()
    if raw.startswith("google/"):
        raw = raw.split("/", 1)[1]

    aliases = {
        "gemini-3.1": "gemini-3.1-pro-preview",
        "gemini-3.1-pro": "gemini-3.1-pro-preview",
        "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
        "gemini-3.1-flash": "gemini-3.1-flash-lite-preview",
        "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
    }
    return aliases.get(raw, raw or "gemini-3.1-pro-preview")


class GeminiClient:
    def __init__(self, api_key: str, model: str, timeout_seconds: int = 120):
        self.api_key = (api_key or "").strip()
        self.model = normalize_gemini_model(model)
        self.timeout_seconds = timeout_seconds

    def generate_text(self, prompt: str, temperature: float = 0.3) -> str:
        if not self.api_key:
            raise GeminiError("GEMINI_API_KEY 未配置")

        payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": temperature}}

        candidate_models = [self.model]
        if self.model != "gemini-2.5-flash":
            # Free-tier/region often has tighter quotas on preview models.
            candidate_models.append("gemini-2.5-flash")

        last_error: Optional[GeminiError] = None
        for model in candidate_models:
            try:
                return self._generate_once(model=model, payload=payload)
            except GeminiError as exc:
                last_error = exc
                message = str(exc)
                if "429" not in message and "RESOURCE_EXHAUSTED" not in message:
                    break

        raise last_error or GeminiError("Gemini 调用失败")

    def _generate_once(self, *, model: str, payload: dict) -> str:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}"
            f":generateContent?key={self.api_key}"
        )
        response = None
        for attempt in range(3):
            try:
                response = httpx.post(url, json=payload, timeout=self.timeout_seconds)
            except Exception as exc:  # noqa: BLE001
                if attempt < 2:
                    time.sleep(1 + attempt)
                    continue
                raise GeminiError(f"Gemini 请求失败: {exc}") from exc

            if response.status_code != 503:
                break
            if attempt < 2:
                time.sleep(1 + attempt)

        if response is None:
            raise GeminiError("Gemini 请求失败: 无响应")
        if response.status_code >= 400:
            raise GeminiError(f"Gemini 返回错误({response.status_code}): {response.text}")

        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise GeminiError("Gemini 响应缺少 candidates")

        parts = candidates[0].get("content", {}).get("parts", [])
        texts = []
        for item in parts:
            text = item.get("text") if isinstance(item, dict) else None
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())

        merged = "\n".join(texts).strip()
        if not merged:
            raise GeminiError("Gemini 返回内容为空")
        return merged
