from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import relationship

from app.database import Base


resource_tags = Table(
    "resource_tags",
    Base.metadata,
    Column("resource_id", ForeignKey("resources.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)


class Resource(Base):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String(2048), unique=True, nullable=False, index=True)
    title = Column(String(512), nullable=True)
    content = Column(Text, nullable=False)
    source_type = Column(String(64), nullable=False, default="web", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tags = relationship("Tag", secondary=resource_tags, back_populates="resources")
    drafts = relationship("Draft", back_populates="resource")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    resources = relationship("Resource", secondary=resource_tags, back_populates="tags")


class StyleSample(Base):
    __tablename__ = "style_samples"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False, unique=True)
    sample_text = Column(Text, nullable=False)
    banned_words = Column(Text, nullable=True)
    banned_patterns = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Draft(Base):
    __tablename__ = "drafts"

    id = Column(Integer, primary_key=True, index=True)
    topic = Column(String(512), nullable=True)
    resource_id = Column(Integer, ForeignKey("resources.id"), nullable=True, index=True)

    writer_model = Column(String(128), nullable=False, default="gpt-5.4")
    critic_model = Column(String(128), nullable=False, default="gemini-3.1")

    writer_output = Column(Text, nullable=True)
    critic_feedback = Column(Text, nullable=True)
    final_output = Column(Text, nullable=True)
    conversation_log = Column(Text, nullable=False)

    status = Column(String(32), nullable=False, default="completed")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    resource = relationship("Resource", back_populates="drafts")
