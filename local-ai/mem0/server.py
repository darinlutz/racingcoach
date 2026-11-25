"""The Clarivex Memory Service's Mem0 sidecar (docs/AI_MEMORY_SETUP.md, Mem0).

Runs on the Mac beside Ollama, on 127.0.0.1 only, reached by the website through the gateway's /lab/mem0/* routes
(local-ai/memoryRoutes.ts). Mem0 (mem0ai, pinned in requirements.txt) is used for two things, both behind the
website's MemoryIntelligenceProvider so it stays replaceable:

  extract  Mem0's fact extraction (Memory.add with infer=True) on a throwaway user ID, quarantine-<job>, whose
           memories are deleted before answering: nothing Mem0 extracts is ever stored here or retrievable. The
           website validates the facts and puts them through approval.
  search   similarity over Mem0's own index of APPROVED memories, one Mem0 user per namespace path, which the
           website's outbox keeps in step (upsert/delete, infer=False so Mem0 stores the text as given).

PostgreSQL on the website is authoritative: this index can be deleted at any time (rm -rf the data folder) and
rebuilt by Jobs and Synchronization > Reconcile. Mem0's internal tables are never touched directly; index.json maps
the website's memory IDs to Mem0's.

Environment (local-ai/mem0/.env.example): MEM0_HOST/MEM0_PORT (127.0.0.1:8765), OLLAMA_URL, MEM0_LLM_MODEL,
MEM0_EMBED_MODEL, MEM0_EMBED_DIMS, MEM0_DATA_DIR. Telemetry to Mem0's servers is turned off.
"""

import json
import os
import re
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Before mem0 is imported: no telemetry leaves the Mac
os.environ["MEM0_TELEMETRY"] = "False"

HERE = Path(__file__).resolve().parent


def load_env():
    env = HERE / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


load_env()

HOST = os.environ.get("MEM0_HOST", "127.0.0.1")
PORT = int(os.environ.get("MEM0_PORT", "8765"))
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
LLM = os.environ.get("MEM0_LLM_MODEL", "qwen3:8b")
EMBED = os.environ.get("MEM0_EMBED_MODEL", "qwen3-embedding:0.6b")
DIMS = int(os.environ.get("MEM0_EMBED_DIMS", "1024"))
DATA = Path(os.path.expanduser(os.environ.get("MEM0_DATA_DIR", "~/.racingcoach/mem0")))
COLLECTION = os.environ.get("MEM0_COLLECTION", "clarivex_memory")

if HOST not in ("127.0.0.1", "localhost", "::1"):
    sys.exit("MEM0_HOST must be 127.0.0.1: the sidecar is reached only through the gateway")

DATA.mkdir(parents=True, exist_ok=True)
INDEX_FILE = DATA / "index.json"

from mem0 import Memory  # noqa: E402
import importlib.metadata as metadata  # noqa: E402

VERSION = metadata.version("mem0ai")
CONFIG = {
    "llm": {"provider": "ollama", "config": {"model": LLM, "temperature": 0, "max_tokens": 2000, "ollama_base_url": OLLAMA}},
    "embedder": {"provider": "ollama", "config": {"model": EMBED, "ollama_base_url": OLLAMA, "embedding_dims": DIMS}},
    "vector_store": {"provider": "qdrant", "config": {"path": str(DATA / "qdrant"), "on_disk": True, "collection_name": COLLECTION, "embedding_model_dims": DIMS}},
    "history_db_path": str(DATA / "history.db"),
}

memory = Memory.from_config(CONFIG)
lock = threading.Lock()  # Qdrant's local mode is one process, one writer at a time


def read_index():
    try:
        return json.loads(INDEX_FILE.read_text())
    except Exception:
        return {}


def write_index(index):
    tmp = INDEX_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(index))
    tmp.replace(INDEX_FILE)


UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
NAMESPACE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}(/[a-z0-9][a-z0-9-]{0,47}){0,5}$")


def text(v, limit):
    return v if isinstance(v, str) and 0 < len(v) <= limit else None


def delete_ids(ids):
    for mid in ids:
        try:
            memory.delete(mid)
        except Exception:
            pass  # already gone


def op_health(_b):
    return 200, {"ok": True, "version": VERSION, "llm": LLM, "embedder": EMBED, "dims": DIMS, "indexed": len(read_index())}


def op_extract(b):
    job = b.get("job_id")
    messages = b.get("messages")
    if not isinstance(job, str) or not UUID.match(job) or not isinstance(messages, list) or not messages or len(messages) > 40:
        return 400, {"error": "badRequest"}
    clean = []
    for m in messages:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or not text(m.get("content"), 8000):
            return 400, {"error": "badMessage"}
        clean.append({"role": m["role"], "content": m["content"]})
    # Only what the user said: with qwen3:8b, mem0ai 2.2.1's single-pass extractor returns nothing when the
    # conversation ends on an assistant turn (checked 2026-11-24), and an assistant's statement isn't a verified
    # fact anyway (the native provider still reads both sides)
    clean = [m for m in clean if m["role"] == "user"]
    if not clean:
        return 200, {"facts": [], "model": LLM, "ms": 0}
    quarantine = f"quarantine-{job}"
    started = time.time()
    try:
        result = memory.add(clean, user_id=quarantine, infer=True)
        facts = [r.get("memory") for r in result.get("results", []) if r.get("event") == "ADD" and isinstance(r.get("memory"), str)]
    finally:
        # Never kept: the facts go back to the website for validation and approval
        try:
            memory.delete_all(user_id=quarantine)
        except Exception:
            traceback.print_exc()
    return 200, {"facts": facts[:20], "model": LLM, "ms": int((time.time() - started) * 1000)}


def op_upsert(b):
    mid = b.get("memory_id")
    ns = b.get("namespace")
    body = text(b.get("text"), 4000)
    meta = b.get("metadata") if isinstance(b.get("metadata"), dict) else {}
    if not isinstance(mid, str) or not UUID.match(mid) or not isinstance(ns, str) or not NAMESPACE.match(ns) or not body:
        return 400, {"error": "badRequest"}
    index = read_index()
    old = index.get(mid, {}).get("ids", [])
    result = memory.add([{"role": "user", "content": body}], user_id=ns, infer=False, metadata={"memory_id": mid, "version": int(meta.get("version", 0))})
    ids = [r["id"] for r in result.get("results", []) if r.get("id")]
    # The new copy first, then the old one removed: a failure in between leaves a duplicate, never a gap
    delete_ids([i for i in old if i not in ids])
    index[mid] = {"ids": ids, "namespace": ns, "version": int(meta.get("version", 0))}
    write_index(index)
    return 200, {"ids": ids}


def op_delete(b):
    mid = b.get("memory_id")
    if not isinstance(mid, str) or not UUID.match(mid):
        return 400, {"error": "badRequest"}
    index = read_index()
    entry = index.pop(mid, None)
    if entry:
        delete_ids(entry.get("ids", []))
        write_index(index)
    return 200, {"deleted": bool(entry)}


def op_list(_b):
    index = read_index()
    return 200, {"memories": [{"memory_id": k, "version": v.get("version", 0), "namespace": v.get("namespace")} for k, v in index.items()]}


def op_search(b):
    q = text(b.get("query"), 2000)
    namespaces = b.get("namespaces")
    limit = b.get("limit") if isinstance(b.get("limit"), int) and 0 < b.get("limit") <= 50 else 8
    if not q or not isinstance(namespaces, list) or not namespaces or len(namespaces) > 50 or not all(isinstance(n, str) and NAMESPACE.match(n) for n in namespaces):
        return 400, {"error": "badRequest"}
    hits = []
    for ns in namespaces:
        r = memory.search(q, filters={"user_id": ns}, top_k=limit)
        for h in r.get("results", []):
            md = h.get("metadata") or {}
            if md.get("memory_id"):
                hits.append({"memory_id": md["memory_id"], "score": h.get("score"), "namespace": ns})
    hits.sort(key=lambda h: -(h["score"] or 0))
    seen, out = set(), []
    for h in hits:
        if h["memory_id"] not in seen:
            seen.add(h["memory_id"])
            out.append(h)
    return 200, {"results": out[:limit]}


OPS = {"health": op_health, "extract": op_extract, "upsert": op_upsert, "delete": op_delete, "list": op_list, "search": op_search}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        op = OPS.get(self.path.strip("/"))
        if not op:
            return self.reply(404, {"error": "notFound"})
        length = int(self.headers.get("content-length") or 0)
        if length > 256_000:
            return self.reply(413, {"error": "tooLarge"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self.reply(400, {"error": "notJson"})
        try:
            with lock:
                status, out = op(body if isinstance(body, dict) else {})
            self.reply(status, out)
        except Exception as error:
            traceback.print_exc()
            self.reply(502, {"error": "mem0Error", "detail": str(error)[:300]})

    def log_message(self, fmt, *args):
        # Paths and statuses only: never a body
        sys.stderr.write("%s mem0 %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), fmt % args))


if __name__ == "__main__":
    print(f"Mem0 sidecar {VERSION} on http://{HOST}:{PORT} (LLM {LLM}, embedder {EMBED}/{DIMS}, data {DATA})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
