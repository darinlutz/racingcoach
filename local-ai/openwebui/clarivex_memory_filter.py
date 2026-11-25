"""
title: Clarivex Memory
author: Clarivex
version: 1.0.0
license: Proprietary
description: Centralized memory from the Clarivex Memory Service (RacingCoach). Retrieves approved memories before each request and queues extraction after each answer. docs/AI_MEMORY_OPEN_WEBUI.md
"""

# Install: Open WebUI > Admin Panel > Functions > + (Import from code), paste this file, Save, turn it on and make
# it Global (or attach it to the models that should use it), then set its Valves: api_key (a cmk_ key made in
# AI Lab > Memory Manager > System Settings > API clients, whose subjects include your Open WebUI user ID) and the
# namespaces. Written against Open WebUI 0.13.4's filter interface (inlet/outlet, __user__, __metadata__).
#
# What it never does: write to Open WebUI's own memory, decide what is approved, or hold any secret but its key.
# The Memory API checks the key, the user (X-Memory-Subject) and the namespaces on every request. When the Memory
# API is slow or down the chat carries on without memory (a status line says so).

import json
import re
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

CONTEXT_TAG = "<memory_context>"


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


class Filter:
    class Valves(BaseModel):
        api_url: str = Field(default="https://racingcoach.app/api/memory/v1", description="The Memory API (https, no trailing slash)")
        api_key: str = Field(default="", description="A Memory API client key (cmk_...)")
        retrieval_namespaces: str = Field(default="", description="Comma-separated namespace paths to read; empty = every namespace the key may read")
        default_namespace: str = Field(default="personal", description="Where extracted memories are proposed")
        include_children: bool = Field(default=True, description="Read child namespaces too")
        extract: bool = Field(default=True, description="Queue extraction after each answer")
        extract_every_messages: int = Field(default=1, description="Extract after every N user messages")
        extract_window: int = Field(default=4, description="How many recent messages are sent for extraction")
        timeout_seconds: float = Field(default=4.0, description="Retrieval timeout; the chat never waits longer")
        show_status: bool = Field(default=True, description="Show how many memories were used")
        priority: int = Field(default=0, description="Filter order")

    class UserValves(BaseModel):
        enabled: bool = Field(default=True, description="Use centralized memory in my chats")
        namespace: str = Field(default="", description="My namespace (checked by the server)")
        extract: bool = Field(default=True, description="Propose memories from my chats")

    def __init__(self):
        self.valves = self.Valves()

    def _headers(self, user: dict, request_id: Optional[str]) -> dict:
        h = {"authorization": f"Bearer {self.valves.api_key}", "content-type": "application/json", "x-memory-subject": str(user.get("id", ""))}
        if request_id and re.fullmatch(r"[A-Za-z0-9._:-]{8,100}", request_id):
            h["x-request-id"] = request_id
        return h

    def _ready(self, user: Optional[dict]) -> bool:
        if not user or not self.valves.api_key.startswith("cmk_"):
            return False
        # https, or plain http only to this Mac (a local development server, reached from Docker as host.docker.internal)
        url = self.valves.api_url
        if not (url.startswith("https://") or url.startswith(("http://127.0.0.1", "http://localhost", "http://host.docker.internal"))):
            return False
        uv = user.get("valves")
        return getattr(uv, "enabled", True) if uv is not None else True

    async def _status(self, emitter, text: str, done: bool = True):
        if emitter and self.valves.show_status:
            try:
                await emitter({"type": "status", "data": {"description": text, "done": done}})
            except Exception:
                pass

    async def inlet(self, body: dict, __user__: Optional[dict] = None, __metadata__: Optional[dict] = None, __event_emitter__=None) -> dict:
        meta = __metadata__ or {}
        # Title, tag and follow-up generation are tasks, not the conversation: no memory there
        if meta.get("task") or not self._ready(__user__):
            return body
        messages = body.get("messages") or []
        # Never inject twice: drop any earlier block this filter added
        messages = [m for m in messages if not (m.get("role") == "system" and CONTEXT_TAG in _text(m.get("content")))]
        last_user = next((i for i in range(len(messages) - 1, -1, -1) if messages[i].get("role") == "user"), None)
        if last_user is None:
            body["messages"] = messages
            return body
        query = _text(messages[last_user].get("content")).strip()[:2000]
        if not query:
            return body
        uv = __user__.get("valves")
        namespaces = [n.strip() for n in self.valves.retrieval_namespaces.split(",") if n.strip()]
        if uv is not None and getattr(uv, "namespace", ""):
            namespaces = [uv.namespace.strip()]
        payload = {"query": query, "includeChildren": self.valves.include_children, "model": str(body.get("model", ""))[:100]}
        if namespaces:
            payload["namespaces"] = namespaces
        request_id = f"{meta.get('chat_id', 'chat')}:{meta.get('message_id', 'msg')}"
        try:
            async with httpx.AsyncClient(timeout=self.valves.timeout_seconds) as client:
                r = await client.post(f"{self.valves.api_url}/retrieve", headers=self._headers(__user__, request_id), json=payload)
            if r.status_code != 200:
                await self._status(__event_emitter__, f"Memory unavailable ({r.status_code})")
                body["messages"] = messages
                return body
            data = r.json()
        except Exception:
            await self._status(__event_emitter__, "Memory unavailable (timeout)")
            body["messages"] = messages
            return body
        context = data.get("context") or ""
        if context:
            # A separate system message just before the user's question: the model's own system prompt stays first
            # and unchanged, and the block says it is reference data, not instructions
            messages.insert(last_user, {"role": "system", "content": context})
        if (body.get("features") or {}).get("memory"):
            await self._status(__event_emitter__, f"Memory: {len(data.get('memories', []))} used (Open WebUI's own memory is also on)")
        else:
            note = f" ({data['degraded']})" if data.get("degraded") else ""
            await self._status(__event_emitter__, f"Memory: {len(data.get('memories', []))} used{note}")
        body["messages"] = messages
        return body

    async def outlet(self, body: dict, __user__: Optional[dict] = None, __metadata__: Optional[dict] = None) -> dict:
        meta = __metadata__ or {}
        if meta.get("task") or not self._ready(__user__) or not self.valves.extract:
            return body
        uv = __user__.get("valves")
        if uv is not None and not getattr(uv, "extract", True):
            return body
        messages = [m for m in (body.get("messages") or []) if m.get("role") in ("user", "assistant") and CONTEXT_TAG not in _text(m.get("content"))]
        user_count = sum(1 for m in messages if m.get("role") == "user")
        if not user_count or user_count % max(1, self.valves.extract_every_messages) != 0:
            return body
        window = [{"role": m["role"], "content": _text(m.get("content"))[:8000]} for m in messages[-max(2, self.valves.extract_window):]]
        chat_id = str(meta.get("chat_id") or "")[:200] or None
        message_id = str(meta.get("message_id") or "")[:200] or None
        namespace = (getattr(uv, "namespace", "") if uv is not None else "") or self.valves.default_namespace
        payload = {"messages": window, "namespace": namespace, "conversationId": chat_id, "messageId": message_id, "model": str(body.get("model", ""))[:100], "trigger": "turn"}
        headers = self._headers(__user__, f"{chat_id}:{message_id}")
        if chat_id and message_id:
            headers["idempotency-key"] = re.sub(r"[^A-Za-z0-9._:-]", "_", f"owui:{chat_id}:{message_id}")[:120]
        try:
            # The Memory API answers 202 at once; the extraction runs later on the server
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(f"{self.valves.api_url}/extract", headers=headers, content=json.dumps(payload))
        except Exception:
            pass
        return body
