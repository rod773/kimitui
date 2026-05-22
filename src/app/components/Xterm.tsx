"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function Xterm() {
  const [ready, setReady] = useState(false);
  const [cwd, setCwd] = useState("");
  const [status, setStatus] = useState<"dir" | "starting" | "active" | "error">("dir");
  const containerRef = useRef<HTMLDivElement>(null);

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  useEffect(() => {
    if (!ready || !containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: "'Courier New', monospace",
      theme: { background: "#000", foreground: "#00ff41", cursor: "#00ff41", selectionBackground: "#00ff4133" },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    term.focus();
    setStatus("starting");

    let aborted = false;

    (async () => {
      try {
        const res = await fetch(`/api/terminal?cwd=${encodeURIComponent(cwd || "")}`);
        if (!res.body || aborted) { setStatus("error"); return; }
        setStatus("active");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;
          term.write(decoder.decode(value, { stream: true }));
        }
      } catch {
        if (!aborted) setStatus("error");
      }
    })();

    term.onData((data) => {
      fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: data }),
      }).catch(() => {});
    });

    const container = containerRef.current;
    const onClick = () => term.focus();
    container.addEventListener("click", onClick);
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    setTimeout(() => { fit.fit(); term.focus(); }, 100);

    return () => {
      aborted = true;
      window.removeEventListener("resize", onResize);
      container.removeEventListener("click", onClick);
      fetch("/api/terminal", { method: "DELETE" }).catch(() => {});
      term.dispose();
    };
  }, [ready, cwd]);

  if (!isLocal) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-green-600 text-sm">
          Terminal only works locally. Run <span className="text-green-400">yarn dev</span> and open localhost:3000.
        </p>
      </div>
    );
  }

  if (status === "dir") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <p className="text-green-600 text-sm">Enter working directory or leave empty for project root</p>
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="e.g. C:\Users\yourname\projects or ~/code"
          className="w-full max-w-xl bg-black border border-green-700 text-green-400 px-3 py-2 font-mono text-sm outline-none focus:border-green-400"
        />
        <button
          onClick={() => setReady(true)}
          className="border border-green-500 text-green-400 px-4 py-1 text-sm hover:bg-green-900"
        >
          Start Terminal
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-1 text-green-600 text-xs border-b border-green-800">
        {status === "starting" && "Connecting..."}
        {status === "active" && `Terminal — ${cwd || "project root"}`}
        {status === "error" && "Connection failed"}
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden" style={{ background: "#000" }} />
    </div>
  );
}
