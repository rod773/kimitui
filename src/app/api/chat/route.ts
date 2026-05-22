const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

function cfHeaders() {
  const token = process.env.CLOUDFLARE_API_TOKEN || "";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function cfUrl(path: string) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  return `${CF_API_BASE}/${account}/ai${path}`;
}

function modelFamily(name: string): string {
  const parts = name.split("/");
  return parts.length >= 3 ? parts[1] : parts.length >= 2 ? parts[0] : "other";
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action, model, messages, family } = body;

  const encoder = new TextEncoder();

  const send = (data: Record<string, unknown>) =>
    encoder.encode(JSON.stringify(data) + "\n");

  const stream = new ReadableStream({
    async start(controller) {
      try {
        switch (action) {
          case "list_families": {
            const res = await fetch(cfUrl("/models/search"), {
              headers: cfHeaders(),
            });
            const data = await res.json() as { success: boolean; result?: Array<{ name: string; task?: { id: string } }>; errors?: Array<{ message: string }> };
            if (!data.success) {
              controller.enqueue(send({ type: "error", message: data.errors?.[0]?.message || "Unknown error" }));
              controller.close();
              return;
            }
            const textGenTask = "c329a1f9-323d-4e91-b2aa-582dd4188d34";
            const chatModels = (data.result || []).filter(
              (m: { name: string; task?: { id: string } }) => m.task?.id === textGenTask
            );
            const families: Record<string, string[]> = {};
            for (const m of chatModels) {
              const f = modelFamily(m.name);
              if (!families[f]) families[f] = [];
              families[f].push(m.name);
            }
            const result = Object.entries(families)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([family, models]) => ({ family, models: models.slice(0, 5) }));
            controller.enqueue(send({ type: "result", data: result }));
            controller.close();
            return;
          }

          case "list_models": {
            const res = await fetch(cfUrl("/models/search"), {
              headers: cfHeaders(),
            });
            const data = await res.json() as { success: boolean; result?: Array<{ name: string; task?: { id: string } }>; errors?: Array<{ message: string }> };
            if (!data.success) {
              controller.enqueue(send({ type: "error", message: data.errors?.[0]?.message || "Unknown error" }));
              controller.close();
              return;
            }
            const textGenTask = "c329a1f9-323d-4e91-b2aa-582dd4188d34";
            let chatModels = (data.result || [])
              .filter((m: { name: string; task?: { id: string } }) => m.task?.id === textGenTask)
              .map((m: { name: string }) => m.name);
            if (family) {
              chatModels = chatModels.filter((n: string) => modelFamily(n) === family);
            }
            const sorted = [...new Set(chatModels)].sort() as string[];
            controller.enqueue(send({ type: "result", data: sorted.slice(0, 50) }));
            controller.close();
            return;
          }

          case "model_info": {
            const res = await fetch(cfUrl("/models/search"), {
              headers: cfHeaders(),
            });
            const data = await res.json() as { success: boolean; result?: Array<{ name: string; task?: { name: string } }> };
            if (!data.success) {
              controller.enqueue(send({ type: "error", message: "Failed to fetch models" }));
              controller.close();
              return;
            }
            const found = (data.result || []).find((m: { name: string }) => m.name === model);
            if (!found) {
              controller.enqueue(send({ type: "error", message: `Model '${model}' not found` }));
              controller.close();
              return;
            }
            controller.enqueue(
              send({
                type: "result",
                data: {
                  id: found.name,
                  author: modelFamily(found.name),
                  pipeline_tag: found.task?.name || "text-generation",
                  private: false,
                  downloads: 0,
                  likes: 0,
                },
              })
            );
            controller.close();
            return;
          }

          case "chat": {
            const res = await fetch(cfUrl("/v1/chat/completions"), {
              method: "POST",
              headers: cfHeaders(),
              body: JSON.stringify({ model, messages, stream: false }),
            });
            const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
            const content = data.choices?.[0]?.message?.content || "";
            if (content) {
              controller.enqueue(send({ type: "result", data: content }));
            } else {
              controller.enqueue(send({ type: "error", message: "Empty response" }));
            }
            controller.close();
            return;
          }

          case "stream_chat": {
            const res = await fetch(cfUrl("/v1/chat/completions"), {
              method: "POST",
              headers: cfHeaders(),
              body: JSON.stringify({ model, messages, stream: true }),
            });
            if (!res.body) {
              controller.enqueue(send({ type: "error", message: "No response body" }));
              controller.close();
              return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop() || "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data: ")) continue;
                const chunk = trimmed.slice(6);
                if (!chunk) continue;
                try {
                  const parsed = JSON.parse(chunk) as {
                    choices?: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
                  };
                  const choices = parsed.choices || [];
                  if (choices[0]?.finish_reason === "stop") {
                    controller.enqueue(send({ type: "done" }));
                    controller.close();
                    return;
                  }
                  const content = choices[0]?.delta?.content || "";
                  if (content) {
                    controller.enqueue(send({ type: "chunk", data: content }));
                  }
                } catch {
                  // skip
                }
              }
            }
            controller.enqueue(send({ type: "done" }));
            controller.close();
            return;
          }

          default:
            controller.enqueue(send({ type: "error", message: `Unknown action: ${action}` }));
            controller.close();
        }
      } catch (err) {
        controller.enqueue(
          send({ type: "error", message: err instanceof Error ? err.message : "Internal error" })
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
