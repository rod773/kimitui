import { spawn, ChildProcess } from "child_process";

let proc: ChildProcess | null = null;
let currentCwd = "";
let outputControllers: ReadableStreamDefaultController[] = [];

function startShell(cwd?: string) {
  if (proc) {
    proc.kill();
    proc = null;
  }
  const dir = cwd || process.cwd();
  currentCwd = dir;
  const isWin = process.platform === "win32";
  const shell = isWin
    ? spawn("cmd.exe", [], { stdio: ["pipe", "pipe", "pipe"], cwd: dir })
    : spawn("/bin/bash", [], { stdio: ["pipe", "pipe", "pipe"], cwd: dir });

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get("cwd") || undefined;

  startShell(cwd);

  let thisController: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      thisController = controller;
      outputControllers.push(controller);
      controller.enqueue(new TextEncoder().encode(`\x1b[32mTerminal started in: ${currentCwd}\r\n\r\n\x1b[0m`));
    },
    cancel() {
      if (thisController) {
        outputControllers = outputControllers.filter((c) => c !== thisController);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function POST(request: Request) {
  try {
    const { input } = await request.json();
    if (proc && input) {
      proc.stdin?.write(input);
    }
    return new Response("ok");
  } catch {
    return new Response("error", { status: 400 });
  }
}

export async function DELETE() {
  if (proc) {
    proc.kill();
    proc = null;
  }
  outputControllers = [];
  return new Response("ok");
}

export async function OPTIONS() {
  return Response.json({ cwd: process.cwd() });
}
