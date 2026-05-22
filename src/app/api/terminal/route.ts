import { spawn, ChildProcess } from "child_process";
import path from "path";

let proc: ChildProcess | null = null;
let outputControllers: ReadableStreamDefaultController[] = [];

function startShell() {
  if (proc) return;
  const isWin = process.platform === "win32";
  const shell = isWin
    ? spawn("cmd.exe", [], { stdio: ["pipe", "pipe", "pipe"], cwd: process.cwd() })
    : spawn("/bin/bash", [], { stdio: ["pipe", "pipe", "pipe"], cwd: process.cwd() });

  const onData = (data: Buffer) => {
    const encoded = new TextEncoder().encode(data.toString());
    for (const ctrl of outputControllers) {
      try { ctrl.enqueue(encoded); } catch { /* ignore */ }
    }
  };

  shell.stdout?.on("data", onData);
  shell.stderr?.on("data", onData);

  shell.on("exit", () => {
    proc = null;
    for (const ctrl of outputControllers) {
      try { ctrl.close(); } catch { /* ignore */ }
    }
    outputControllers = [];
  });

  proc = shell;
}

export async function GET() {
  startShell();

  const stream = new ReadableStream({
    start(controller) {
      outputControllers.push(controller);
    },
    cancel() {
      outputControllers = outputControllers.filter((c) => c !== null);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const { input } = await request.json();
  if (!proc) startShell();
  proc?.stdin?.write(input);
  return new Response("ok");
}

export async function DELETE() {
  if (proc) {
    proc.kill();
    proc = null;
  }
  return new Response("ok");
}
