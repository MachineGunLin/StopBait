from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_host: str = os.getenv("APP_HOST", "0.0.0.0")
    app_port: int = _int_env("APP_PORT", 8080)

    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./soul_draft.db")

    openclaw_base_url: str = os.getenv("OPENCLAW_BASE_URL", "http://127.0.0.1:8081")
    openclaw_gateway_token: str = os.getenv("OPENCLAW_GATEWAY_TOKEN", "")
    openclaw_writer_model: str = os.getenv("OPENCLAW_WRITER_MODEL", "gpt-5.4")
    openclaw_critic_model: str = os.getenv("OPENCLAW_CRITIC_MODEL", "gemini-3.1")
    openclaw_timeout_seconds: int = _int_env("OPENCLAW_TIMEOUT_SECONDS", 120)

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    tavily_api_key: str = os.getenv("TAVILY_API_KEY", "")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
