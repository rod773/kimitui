import sys
import json
import os
import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")

def send(data):
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()

if not ACCOUNT_ID or not API_TOKEN:
    send({"type": "error", "message": "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env"})
    sys.exit(1)

BASE_URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}

client = httpx.Client(timeout=120)

def model_family(name):
    parts = name.split("/")
    if len(parts) >= 3:
        return parts[1]
    if len(parts) >= 2:
        return parts[0]
    return "other"

def model_short_name(name):
    parts = name.split("/")
    if len(parts) >= 3:
        return "/".join(parts[2:])
    return name

def handle_list_families():
    try:
        resp = client.get(f"{BASE_URL}/models/search", headers=HEADERS)
        data = resp.json()
        if not data.get("success"):
            send({"type": "error", "message": data.get("errors", [{}])[0].get("message", "Unknown error")})
            return
        all_models = data.get("result", [])
        text_gen_task = "c329a1f9-323d-4e91-b2aa-582dd4188d34"
        models = [m for m in all_models if m.get("task", {}).get("id") == text_gen_task]
        families = {}
        for m in models:
            name = m.get("name", "")
            family = model_family(name)
            if family not in families:
                families[family] = []
            families[family].append(name)
        result = [{"family": k, "models": v[:5]} for k, v in sorted(families.items())]
        send({"type": "result", "data": result})
    except Exception as e:
        send({"type": "error", "message": str(e)})

def handle_list_models(family=None):
    try:
        resp = client.get(f"{BASE_URL}/models/search", headers=HEADERS)
        data = resp.json()
        if not data.get("success"):
            send({"type": "error", "message": data.get("errors", [{}])[0].get("message", "Unknown error")})
            return
        all_models = data.get("result", [])
        text_gen_task = "c329a1f9-323d-4e91-b2aa-582dd4188d34"
        chat_models = [
            m.get("name", "")
            for m in all_models
            if m.get("task", {}).get("id") == text_gen_task
        ]
        if family:
            model_list = [m for m in chat_models if model_family(m) == family]
        else:
            model_list = chat_models
        model_list = sorted(set(model_list))[:50]
        send({"type": "result", "data": model_list})
    except Exception as e:
        send({"type": "error", "message": str(e)})

def handle_model_info(model_name):
    try:
        resp = client.get(f"{BASE_URL}/models/search", headers=HEADERS)
        data = resp.json()
        if not data.get("success"):
            send({"type": "error", "message": data.get("errors", [{}])[0].get("message", "Unknown error")})
            return
        for m in data.get("result", []):
            if m.get("name") == model_name:
                send({"type": "result", "data": {
                    "id": m.get("name", model_name),
                    "author": model_family(m.get("name", "")),
                    "pipeline_tag": m.get("task", {}).get("name", "text-generation"),
                    "private": False,
                    "downloads": 0,
                    "likes": 0,
                }})
                return
        send({"type": "error", "message": f"Model '{model_name}' not found"})
    except Exception as e:
        send({"type": "error", "message": str(e)})

def handle_chat(model, messages):
    try:
        payload = {"model": model, "messages": messages, "stream": False}
        resp = client.post(
            f"{BASE_URL}/v1/chat/completions",
            headers=HEADERS,
            json=payload,
        )
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if content:
            send({"type": "result", "data": content})
        else:
            send({"type": "error", "message": "Empty response from Cloudflare AI"})
    except Exception as e:
        send({"type": "error", "message": str(e)})

def handle_stream_chat(model, messages):
    try:
        payload = {"model": model, "messages": messages, "stream": True}
        with client.stream(
            "POST",
            f"{BASE_URL}/v1/chat/completions",
            headers=HEADERS,
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                error_body = resp.read()
                try:
                    err = json.loads(error_body)
                    msg = err.get("errors", [{}])[0].get("message", "Unknown error")
                except json.JSONDecodeError:
                    msg = error_body.decode()
                send({"type": "error", "message": msg})
                return
            for line in resp.iter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:].strip()
                if not chunk:
                    continue
                try:
                    chunk_data = json.loads(chunk)
                    choices = chunk_data.get("choices", [])
                    if not choices:
                        continue
                    finish = choices[0].get("finish_reason")
                    if finish == "stop":
                        send({"type": "done"})
                        return
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        send({"type": "chunk", "data": content})
                except json.JSONDecodeError:
                    continue
            send({"type": "done"})
    except Exception as e:
        send({"type": "error", "message": str(e)})

HANDLERS = {
    "list_families": lambda d: handle_list_families(),
    "list_models": lambda d: handle_list_models(d.get("family")),
    "model_info": lambda d: handle_model_info(d["model"]),
    "chat": lambda d: handle_chat(d["model"], d["messages"]),
    "stream_chat": lambda d: handle_stream_chat(d["model"], d["messages"]),
}

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            handler = HANDLERS.get(request.get("type"))
            if handler:
                handler(request)
            else:
                send({"type": "error", "message": f"Unknown request type: {request.get('type')}"})
        except json.JSONDecodeError:
            send({"type": "error", "message": "Invalid JSON"})

if __name__ == "__main__":
    main()
