# SoulDraft API Handover

## 1) 服务地址
- FastAPI: `http://localhost:8080`
- OpenClaw Gateway: `ws://127.0.0.1:8081`（脚本按本地无鉴权模式启动）

## 2) 环境变量
项目根目录已创建 `.env`，请补充：
- `OPENAI_API_KEY=`
- `GEMINI_API_KEY=`
- `TAVILY_API_KEY=`

可选：
- `OPENCLAW_BASE_URL=http://127.0.0.1:8081`
- `OPENCLAW_WRITER_MODEL=gpt-5.4`
- `OPENCLAW_CRITIC_MODEL=gemini-3.1`

## 3) 启动命令
```bash
# OpenClaw（前台）
./scripts/start_openclaw.sh

# FastAPI（前台）
./scripts/start_backend.sh
```

## 4) 接口定义

### POST `/api/collect`
抓取 URL 正文并入库，支持标签绑定。

请求体：
```json
{
  "url": "https://example.com",
  "tags": ["示例", "测试"],
  "source_type": "manual"
}
```

响应示例：
```json
{
  "id": 1,
  "url": "https://example.com/",
  "title": "Example Domain",
  "content": "...",
  "source_type": "manual",
  "tags": ["测试", "示例"],
  "created_at": "2026-03-26T14:08:51.393712"
}
```

curl：
```bash
curl -X POST http://127.0.0.1:8080/api/collect \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","tags":["示例","测试"],"source_type":"manual"}'
```

### GET `/api/tags`
返回所有标签列表。

响应示例：
```json
[
  {"id": 1, "name": "测试"},
  {"id": 2, "name": "示例"}
]
```

curl：
```bash
curl http://127.0.0.1:8080/api/tags
```

### POST `/api/generate`
输入 `topic` 或 `resource_id`，执行 Writer(GPT-5.4) -> Critic(Gemini 3.1) 协作流程，并落库到 `Draft`。

请求体（任选其一）：
```json
{"topic":"AI 时代个人效率系统"}
```
```json
{"resource_id":1}
```

响应示例：
```json
{
  "draft_id": 4,
  "status": "completed_with_fallback",
  "writer_model": "gpt-5.4",
  "critic_model": "gemini-3.1",
  "writer_output": "....",
  "critic_feedback": "....",
  "final_output": "....",
  "error_message": "writer 调用失败: OpenClaw 请求失败(404): Not Found | critic 调用失败: OpenClaw 请求失败(404): Not Found"
}
```

说明：
- 调用链：`OpenClaw` 为主路径；若 OpenClaw 不可用，会自动降级到 Gemini 直连。
- Gemini 若 `gemini-3.1` 配额不足，会自动降级到 `gemini-2.5-flash`。
- 即使模型调用失败，也会生成 `Draft` 记录（`status=failed`，便于前端展示错误与重试）。
- 当返回 `status=completed_with_fallback` 时，表示内容已生成，但走了降级路径。

curl：
```bash
curl -X POST http://127.0.0.1:8080/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"resource_id":1}'
```

### GET `/api/search`
按关键词或标签检索素材。

查询参数：
- `keyword`：匹配标题/正文/URL
- `tags`：逗号分隔（例如 `AI,快讯`）
- `limit`：默认 20，最大 100

响应示例：
```json
{
  "total": 1,
  "items": [
    {
      "id": 1,
      "url": "https://example.com/",
      "title": "Example Domain",
      "content": "...",
      "source_type": "manual",
      "tags": ["测试", "示例"],
      "created_at": "2026-03-26T14:08:51.393712"
    }
  ]
}
```

curl：
```bash
curl "http://127.0.0.1:8080/api/search?keyword=Example&tags=示例"
```

## 5) 数据库表（SQLite: `soul_draft.db`）
- `resources`: URL、标题、正文、来源类型、时间戳
- `tags`: 标签
- `resource_tags`: `resources` 与 `tags` 多对多中间表
- `style_samples`: 样板文 + 禁止词 + 禁止句式
- `drafts`: 生成草稿 + writer/critic 输出 + 对话记录 + 状态

## 6) 给插件前端的最小接入顺序
1. 先接 `GET /api/tags` 渲染标签选择器。
2. 插件提交收藏内容时调 `POST /api/collect`。
3. 内容生成页调 `POST /api/generate`，读取 `status/error_message` 处理失败重试。
4. 素材列表页调 `GET /api/search`。
