"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Xterm from "./components/Xterm";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ModelInfo = {
  id: string;
  author: string;
  pipeline_tag: string;
  private: boolean;
  downloads: number;
  likes: number;
};

export default function Home() {
  const [mode, setMode] = useState<"chat" | "terminal">("chat");
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: "Welcome to kimitui. Type /help for available commands." },
  ]);
  const [input, setInput] = useState("");
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [pendingModelSelect, setPendingModelSelect] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.5";

  useEffect(() => {
    const saved = localStorage.getItem("kimitui-model");
    if (saved && saved !== DEFAULT_MODEL) {
      localStorage.removeItem("kimitui-model");
    }
    setCurrentModel(DEFAULT_MODEL);
  }, []);

  useEffect(() => {
    if (currentModel) localStorage.setItem("kimitui-model", currentModel);
  }, [currentModel]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming]);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateLastMessage = useCallback((content: string) => {
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.length > 0) {
        copy[copy.length - 1] = { ...copy[copy.length - 1], content };
      }
      return copy;
    });
  }, []);

  const appendToLastMessage = useCallback((chunk: string) => {
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.length > 0) {
        const prevContent = copy[copy.length - 1].content;
        copy[copy.length - 1] = {
          ...copy[copy.length - 1],
          content: prevContent === "Thinking..." ? chunk : prevContent + chunk,
        };
      }
      return copy;
    });
  }, []);

  const handleStreamChat = useCallback(
    async (model: string, userMessage: string) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setStreaming(true);

      addMessage({ role: "user", content: userMessage });
      addMessage({ role: "assistant", content: "Thinking..." });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "stream_chat",
            model,
            messages: [
              { role: "user", content: userMessage },
            ],
          }),
          signal: abort.signal,
        });

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "chunk") {
                appendToLastMessage(parsed.data);
              } else if (parsed.type === "done") {
                setStreaming(false);
              } else if (parsed.type === "error") {
                updateLastMessage(`Error: ${parsed.message}`);
                setStreaming(false);
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          updateLastMessage("\n[Stopped]");
        } else {
          updateLastMessage(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [addMessage, appendToLastMessage, updateLastMessage]
  );

  const fetchModels = useCallback(async () => {
    addMessage({ role: "system", content: "Fetching models..." });
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_models" }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      const lines = buf.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "result") {
            const models: string[] = parsed.data;
            setModelsList(models);
            setPendingModelSelect(true);
            const list = models.map((m, i) => `${i + 1}. ${m}`);
            updateLastMessage(
              ["Available models:", ...list, "", "Type a number to select, or /model <name>"].join("\n")
            );
          } else if (parsed.type === "error") {
            updateLastMessage(`Error: ${parsed.message}`);
          }
        } catch {
          // skip
        }
      }
    } catch {
      updateLastMessage("Failed to fetch models.");
    }
  }, [addMessage, updateLastMessage]);

  const handleCommand = useCallback(
    async (cmd: string) => {
      const parts = cmd.trim().split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);

      switch (command) {
        case "/help":
          addMessage({
            role: "system",
            content: [
              "Available commands:",
              "  /help           - Show this help",
              "  /models         - List available models by number",
              "  /model <name>   - Select a model by name or number",
              "  /info <model>   - Show model details",
              "  /clear          - Clear the chat",
              "  /stop           - Stop streaming",
              "",
              `Current model: ${currentModel || "Not selected"}`,
              "Type any message to chat with the selected model.",
            ].join("\n"),
          });
          break;

        case "/models":
          await fetchModels();
          break;

        case "/model":
          if (args.length === 0) {
            addMessage({ role: "system", content: "Usage: /model <name> or /model <number>" });
            break;
          }
          selectModel(args.join(" "));
          break;

        case "/info":
          if (args.length === 0) {
            addMessage({ role: "system", content: "Usage: /info <model_name>" });
            break;
          }
          const modelName = args.join(" ");
          addMessage({ role: "system", content: `Fetching info for ${modelName}...` });
          try {
            const res = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "model_info", model: modelName }),
            });
            const reader = res.body?.getReader();
            if (!reader) return;
            const decoder = new TextDecoder();
            let buf = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
            }
            const lines = buf.split("\n").filter(Boolean);
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === "result") {
                  const info: ModelInfo = parsed.data;
                  updateLastMessage(
                    [
                      `Model: ${info.id}`,
                      `Author: ${info.author}`,
                      `Type: ${info.pipeline_tag}`,
                      `Private: ${info.private}`,
                      `Downloads: ${info.downloads}`,
                      `Likes: ${info.likes}`,
                    ].join("\n")
                  );
                } else if (parsed.type === "error") {
                  updateLastMessage(`Error: ${parsed.message}`);
                }
              } catch {
                // skip
              }
            }
          } catch {
            updateLastMessage("Failed to fetch model info.");
          }
          break;

        case "/clear":
          setMessages([{ role: "system", content: "Chat cleared." }]);
          break;

        case "/stop":
          if (abortRef.current) {
            abortRef.current.abort();
            addMessage({ role: "system", content: "Streaming stopped." });
          } else {
            addMessage({ role: "system", content: "No active stream to stop." });
          }
          break;

        default:
          addMessage({ role: "system", content: `Unknown command: ${command}. Type /help for available commands.` });
      }
    },
    [addMessage, updateLastMessage, currentModel, fetchModels]
  );

  const selectModel = useCallback(
    (value: string) => {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0 && num <= modelsList.length) {
        const m = modelsList[num - 1];
        setCurrentModel(m);
        setPendingModelSelect(false);
        addMessage({ role: "system", content: `Selected model: ${m}` });
      } else {
        setCurrentModel(value);
        setPendingModelSelect(false);
        addMessage({ role: "system", content: `Selected model: ${value}` });
      }
    },
    [modelsList, addMessage]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || streaming) return;

      setInput("");

      if (trimmed.startsWith("/")) {
        await handleCommand(trimmed);
        return;
      }

      const num = parseInt(trimmed, 10);
      if (pendingModelSelect && !isNaN(num) && num > 0 && num <= modelsList.length) {
        selectModel(trimmed);
        return;
      }

      if (currentModel) {
        await handleStreamChat(currentModel, trimmed);
      } else {
        addMessage({
          role: "system",
          content: "No model selected. Use /models to list and /model <name> to select one.",
        });
      }
    },
    [input, streaming, currentModel, pendingModelSelect, modelsList, handleCommand, handleStreamChat, addMessage, selectModel]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && abortRef.current) {
        abortRef.current.abort();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-black text-green-400 font-mono">
      <Header
        currentModel={currentModel}
        streaming={streaming}
        mode={mode}
        onModeChange={setMode}
      />
      {mode === "chat" ? (
        <>
          <ChatArea messages={messages} chatEndRef={chatEndRef} />
          <InputPrompt
            input={input}
            setInput={setInput}
            handleSubmit={handleSubmit}
            streaming={streaming}
            inputRef={inputRef}
          />
        </>
      ) : (
        <Xterm />
      )}
    </div>
  );
}

const COMMANDS = [
  "/help",
  "/models",
  "/model",
  "/info",
  "/clear",
  "/stop",
];

function Header({
  currentModel,
  streaming,
  mode,
  onModeChange,
}: {
  currentModel: string | null;
  streaming: boolean;
  mode: "chat" | "terminal";
  onModeChange: (m: "chat" | "terminal") => void;
}) {
  return (
    <div className="flex flex-col border-b border-green-700 bg-black text-green-300 text-sm">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="flex items-center gap-3">
          <span className="font-bold text-green-400">kimitui v0.1</span>
          {mode === "chat" && (
            <span className="text-green-200 font-bold">
              {currentModel || "No model selected"}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <button
            onClick={() => onModeChange(mode === "chat" ? "terminal" : "chat")}
            className={`px-2 py-0.5 border text-xs ${
              mode === "terminal"
                ? "border-green-400 text-green-400 bg-green-900"
                : "border-green-700 text-green-600 hover:border-green-500"
            }`}
          >
            [term]
          </button>
          {streaming && (
            <span className="inline-flex items-center gap-1 text-green-500">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Thinking...
            </span>
          )}
        </span>
      </div>
      <div className="flex gap-3 px-4 pb-1.5 text-xs text-green-600">
        <span>commands:</span>
        {COMMANDS.map((cmd) => (
          <span key={cmd}>{cmd}</span>
        ))}
      </div>
    </div>
  );
}

function ChatArea({
  messages,
  chatEndRef,
}: {
  messages: Message[];
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {messages.map((msg, i) => (
        <div key={i} className="whitespace-pre-wrap break-words">
          {msg.role === "user" && (
            <span>
              <span className="text-green-300 font-bold">{"> "}</span>
              <span className="text-green-200">{msg.content}</span>
            </span>
          )}
          {msg.role === "assistant" && (
            <span className="text-green-400">{msg.content}</span>
          )}
          {msg.role === "system" && (
            <span className="text-green-600">{msg.content}</span>
          )}
        </div>
      ))}
      <div ref={chatEndRef} />
    </div>
  );
}

function InputPrompt({
  input,
  setInput,
  handleSubmit,
  streaming,
  inputRef,
}: {
  input: string;
  setInput: (v: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  streaming: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-start gap-2 px-4 pt-3 pb-12 border-t border-green-700 bg-black"
    >
      <span className="text-green-300 font-bold mt-2">{">"}</span>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
        disabled={streaming}
        placeholder={
          streaming ? "Streaming in progress..." : "Type a message or /help"
        }
        rows={3}
        className="flex-1 bg-black text-green-400 border-none outline-none placeholder-green-800 font-mono resize-none"
      />
    </form>
  );
}
