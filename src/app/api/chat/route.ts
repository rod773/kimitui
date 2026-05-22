import { spawn } from "child_process";
import path from "path";

const pythonPath = path.join(process.cwd(), "python", "bridge.py");

function spawnBridge() {
  const proc = spawn("python", [pythonPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  return proc;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action, model, messages, family } = body;

  const proc = spawnBridge();
  let buffer = "";

  const requestMsg: Record<string, unknown> = { type: action };
  if (model) requestMsg.model = model;
  if (messages) requestMsg.messages = messages;
  if (family) requestMsg.family = family;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let abortController: AbortController | null = null;

      proc.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "chunk") {
              controller.enqueue(encoder.encode(JSON.stringify(parsed) + "\n"));
            } else if (parsed.type === "done") {
              controller.enqueue(encoder.encode(JSON.stringify(parsed) + "\n"));
              if (!closed) {
                closed = true;
                controller.close();
              }
            } else if (parsed.type === "result") {
              controller.enqueue(encoder.encode(JSON.stringify(parsed) + "\n"));
              if (!closed) {
                closed = true;
                controller.close();
              }
            } else if (parsed.type === "error") {
              controller.enqueue(encoder.encode(JSON.stringify(parsed) + "\n"));
              if (!closed) {
                closed = true;
                controller.close();
              }
            }
          } catch {
            // incomplete JSON, wait for more data
          }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        console.error("Python stderr:", data.toString());
      });

      proc.on("close", (code) => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      });

      proc.on("error", (err) => {
        if (!closed) {
          closed = true;
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message: err.message }) + "\n")
          );
          controller.close();
        }
      });

      const abortHandler = () => {
        if (!closed) {
          closed = true;
          proc.kill();
          controller.close();
        }
      };

      const req = new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(JSON.stringify(requestMsg) + "\n"));
          c.close();
        },
      });

      req.pipeTo(
        new WritableStream({
          write(chunk) {
            proc.stdin?.write(chunk);
          },
          close() {
            proc.stdin?.end();
          },
        })
      );

      request.signal.addEventListener("abort", abortHandler);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
