"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

function sendInput(data: string) {
  fetch("/api/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: data }),
  }).catch(() => {});
}

export default function Xterm() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: "'Courier New', monospace",
      theme: {
        background: "#000000",
        foreground: "#00ff41",
        cursor: "#00ff41",
        selectionBackground: "#00ff4133",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    term.open(containerRef.current);
    term.focus();

    setTimeout(() => {
      fit.fit();
      term.focus();
    }, 100);

    let aborted = false;

    (async () => {
      try {
        const res = await fetch("/api/terminal");
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;
          term.write(decoder.decode(value, { stream: true }));
        }
      } catch {
        // connection closed
      }
    })();

    term.onData((data) => {
      sendInput(data);
    });

    const onClick = () => term.focus();
    containerRef.current.addEventListener("click", onClick);

    const resize = () => fit.fit();
    window.addEventListener("resize", resize);

    const container = containerRef.current;
    return () => {
      aborted = true;
      window.removeEventListener("resize", resize);
      if (container) container.removeEventListener("click", onClick);
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden"
      style={{ background: "#000" }}
    />
  );
}
