from __future__ import annotations

from typing import Optional, Tuple

import trafilatura


class CollectionError(RuntimeError):
    pass


def collect_from_url(url: str) -> Tuple[Optional[str], str]:
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise CollectionError("网页下载失败")

    metadata = trafilatura.extract_metadata(downloaded)
    title = metadata.title.strip() if metadata and metadata.title else None

    content = trafilatura.extract(
        downloaded,
        output_format="txt",
        include_comments=False,
        include_tables=False,
    )
    if not content:
        raise CollectionError("网页正文提取失败")

    return title, content.strip()
