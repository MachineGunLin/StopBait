from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, HttpUrl, model_validator


class CollectRequest(BaseModel):
    url: HttpUrl
    tags: list[str] = Field(default_factory=list)
    source_type: str = Field(default="web")


class ResourceOut(BaseModel):
    id: int
    url: str
    title: Optional[str]
    content: str
    source_type: str
    tags: list[str]
    created_at: datetime


class TagOut(BaseModel):
    id: int
    name: str


class GenerateRequest(BaseModel):
    topic: Optional[str] = None
    resource_id: Optional[int] = None

    @model_validator(mode="after")
    def validate_topic_or_resource(self) -> "GenerateRequest":
        topic = (self.topic or "").strip()
        if not topic and self.resource_id is None:
            raise ValueError("topic 和 resource_id 至少提供一个")
        if topic:
            self.topic = topic
        return self


class GenerateResponse(BaseModel):
    draft_id: int
    status: str
    writer_model: str
    critic_model: str
    writer_output: Optional[str]
    critic_feedback: Optional[str]
    final_output: Optional[str]
    error_message: Optional[str]


class SearchResponse(BaseModel):
    total: int
    items: list[ResourceOut]
