from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Draft, Resource, StyleSample, Tag
from app.schemas import (
    CollectRequest,
    GenerateRequest,
    GenerateResponse,
    ResourceOut,
    SearchResponse,
    TagOut,
)
from app.services.collector import CollectionError, collect_from_url
from app.services.gemini_client import GeminiClient, GeminiError, normalize_gemini_model
from app.services.openclaw_client import OpenClawClient, OpenClawError

router = APIRouter()


def _resource_to_out(resource: Resource) -> ResourceOut:
    tags = sorted(tag.name for tag in resource.tags)
    return ResourceOut(
        id=resource.id,
        url=resource.url,
        title=resource.title,
        content=resource.content,
        source_type=resource.source_type,
        tags=tags,
        created_at=resource.created_at,
    )


def _build_style_instructions(samples: list[StyleSample]) -> str:
    if not samples:
        return "当前没有 StyleSample 规则，按自然、简洁、可信的中文风格写作。"

    lines: list[str] = []
    for sample in samples:
        lines.append(f"[样板:{sample.name}]\n{sample.sample_text.strip()}")
        if sample.banned_words:
            lines.append(f"禁止词: {sample.banned_words.strip()}")
        if sample.banned_patterns:
            lines.append(f"禁止句式: {sample.banned_patterns.strip()}")
    return "\n\n".join(lines)


@router.post("/api/collect", response_model=ResourceOut)
def collect(payload: CollectRequest, db: Session = Depends(get_db)) -> ResourceOut:
    url = str(payload.url)

    try:
        title, content = collect_from_url(url)
    except CollectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    resource = db.query(Resource).filter(Resource.url == url).first()
    if resource is None:
        resource = Resource(url=url, title=title, content=content, source_type=payload.source_type)
        db.add(resource)
    else:
        resource.title = title
        resource.content = content
        resource.source_type = payload.source_type

    cleaned_tags = sorted({tag.strip() for tag in payload.tags if tag and tag.strip()})
    resource.tags.clear()

    for tag_name in cleaned_tags:
        tag = db.query(Tag).filter(Tag.name == tag_name).first()
        if tag is None:
            tag = Tag(name=tag_name)
            db.add(tag)
            db.flush()
        resource.tags.append(tag)

    db.commit()
    db.refresh(resource)
    return _resource_to_out(resource)


@router.get("/api/tags", response_model=list[TagOut])
def get_tags(db: Session = Depends(get_db)) -> list[TagOut]:
    tags = db.query(Tag).order_by(Tag.name.asc()).all()
    return [TagOut(id=tag.id, name=tag.name) for tag in tags]


@router.post("/api/generate", response_model=GenerateResponse)
def generate(payload: GenerateRequest, db: Session = Depends(get_db)) -> GenerateResponse:
    settings = get_settings()

    resource = None
    if payload.resource_id is not None:
        resource = db.query(Resource).filter(Resource.id == payload.resource_id).first()
        if resource is None:
            raise HTTPException(status_code=404, detail="Resource 不存在")

    topic = payload.topic or (resource.title if resource else None) or "未命名主题"
    context_text = resource.content if resource else f"用户输入主题：{topic}"

    style_samples = db.query(StyleSample).order_by(StyleSample.created_at.asc()).all()
    style_rules = _build_style_instructions(style_samples)

    client = OpenClawClient(
        base_url=settings.openclaw_base_url,
        token=settings.openclaw_gateway_token,
        timeout_seconds=settings.openclaw_timeout_seconds,
    )
    gemini_model = normalize_gemini_model(settings.openclaw_critic_model)
    gemini_client = GeminiClient(
        api_key=settings.gemini_api_key,
        model=gemini_model,
        timeout_seconds=settings.openclaw_timeout_seconds,
    )

    conversation: list[dict[str, str]] = []
    writer_output = None
    critic_feedback = None
    final_output = None
    error_list: list[str] = []
    fallback_used = False

    writer_messages = [
        {
            "role": "system",
            "content": (
                "你是 Writer，目标是输出可直接发布的中文草稿。"
                "请遵守风格规则，结构清晰，避免空话。"
            ),
        },
        {
            "role": "user",
            "content": f"主题: {topic}\n\n素材:\n{context_text}\n\n风格规则:\n{style_rules}",
        },
    ]

    try:
        writer_output = client.chat(model=settings.openclaw_writer_model, messages=writer_messages)
        conversation.append({"role": "writer", "content": writer_output})
    except OpenClawError as exc:
        error_list.append(f"writer 调用失败: {exc}")
        fallback_prompt = (
            "你是 Writer，目标是输出可直接发布的中文草稿。"
            "请遵守风格规则，结构清晰，避免空话。\n\n"
            f"主题: {topic}\n\n素材:\n{context_text}\n\n风格规则:\n{style_rules}"
        )
        try:
            writer_output = gemini_client.generate_text(fallback_prompt, temperature=0.3)
            conversation.append(
                {"role": "writer_fallback", "content": writer_output}
            )
            fallback_used = True
        except GeminiError as gemini_exc:
            error_list.append(f"writer Gemini 降级失败: {gemini_exc}")

    if writer_output:
        critic_messages = [
            {
                "role": "system",
                "content": (
                    "你是 Critic，请审查草稿的逻辑、事实风险、表达冗余和违规词句。"
                    "输出请包含：问题点、修改建议、最终结论。"
                ),
            },
            {
                "role": "user",
                "content": f"主题: {topic}\n\n待审稿件:\n{writer_output}\n\n风格规则:\n{style_rules}",
            },
        ]
        try:
            critic_feedback = client.chat(model=settings.openclaw_critic_model, messages=critic_messages)
            conversation.append({"role": "critic", "content": critic_feedback})
            final_output = writer_output
        except OpenClawError as exc:
            error_list.append(f"critic 调用失败: {exc}")
            critic_prompt = (
                "你是 Critic，请审查草稿的逻辑、事实风险、表达冗余和违规词句。"
                "输出请包含：问题点、修改建议、最终结论。\n\n"
                f"主题: {topic}\n\n待审稿件:\n{writer_output}\n\n风格规则:\n{style_rules}"
            )
            try:
                critic_feedback = gemini_client.generate_text(critic_prompt, temperature=0.2)
                conversation.append(
                    {"role": "critic_fallback", "content": critic_feedback}
                )
                final_output = writer_output
                fallback_used = True
            except GeminiError as gemini_exc:
                error_list.append(f"critic Gemini 降级失败: {gemini_exc}")

    if writer_output and critic_feedback:
        status = "completed_with_fallback" if fallback_used else "completed"
    else:
        status = "failed"
    error_message = " | ".join(error_list) if error_list else None

    draft = Draft(
        topic=topic,
        resource_id=resource.id if resource else None,
        writer_model=settings.openclaw_writer_model,
        critic_model=settings.openclaw_critic_model,
        writer_output=writer_output,
        critic_feedback=critic_feedback,
        final_output=final_output,
        conversation_log=json.dumps(conversation, ensure_ascii=False),
        status=status,
        error_message=error_message,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)

    return GenerateResponse(
        draft_id=draft.id,
        status=draft.status,
        writer_model=draft.writer_model,
        critic_model=draft.critic_model,
        writer_output=draft.writer_output,
        critic_feedback=draft.critic_feedback,
        final_output=draft.final_output,
        error_message=draft.error_message,
    )


@router.get("/api/search", response_model=SearchResponse)
def search(
    keyword: Optional[str] = Query(default=None, description="关键词，搜索标题/正文/URL"),
    tags: Optional[str] = Query(default=None, description="标签，逗号分隔，如: AI,快讯"),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> SearchResponse:
    query = db.query(Resource)

    if keyword and keyword.strip():
        pattern = f"%{keyword.strip()}%"
        query = query.filter(
            or_(
                Resource.title.ilike(pattern),
                Resource.content.ilike(pattern),
                Resource.url.ilike(pattern),
            )
        )

    if tags and tags.strip():
        tag_list = [item.strip() for item in tags.split(",") if item.strip()]
        for tag_name in tag_list:
            query = query.filter(Resource.tags.any(Tag.name == tag_name))

    resources = query.order_by(Resource.created_at.desc()).limit(limit).all()
    items = [_resource_to_out(resource) for resource in resources]

    return SearchResponse(total=len(items), items=items)
