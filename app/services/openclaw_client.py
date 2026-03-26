from __future__ import annotations

from typing import Any

import httpx


class OpenClawError(RuntimeError):
    pass


class OpenClawClient:
    def __init__(self, base_url: str, token: str = "", timeout_seconds: int = 120):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    @staticmethod
    def _normalize_content(content: Any) -> str:
        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            chunks: list[str] = []
            for item in content:
                if isinstance(item, str):
                    chunks.append(item)
                elif isinstance(item, dict):
                    text = item.get("text") or item.get("content")
                    if isinstance(text, str):
                        chunks.append(text)
            return "\n".join(chunk.strip() for chunk in chunks if chunk and chunk.strip())

        if isinstance(content, dict):
            text = content.get("text") or content.get("content")
            if isinstance(text, str):
                return text.strip()

        raise OpenClawError("OpenClaw 返回内容格式无法解析")

    def chat(self, *, model: str, messages: list[dict[str, str]], temperature: float = 0.3) -> str:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }

        try:
            response = httpx.post(
                f"{self.base_url}/v1/chat/completions",
                headers=self._headers(),
                json=payload,
                timeout=self.timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001
            raise OpenClawError(f"连接 OpenClaw 失败: {exc}") from exc

        if response.status_code >= 400:
            raise OpenClawError(f"OpenClaw 请求失败({response.status_code}): {response.text}")

        data = response.json()
        choices = data.get("choices")
        if not choices:
            raise OpenClawError("OpenClaw 响应中缺少 choices")

        message = choices[0].get("message", {})
        content = message.get("content")
        return self._normalize_content(content)
