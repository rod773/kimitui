import { createInterface } from "readline";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function loadEnv() {
  const paths = [join(process.cwd(), ".env"), join(homedir(), ".env")];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] = process.env[key] || val;
    }
  }
}

loadEnv();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("\x1b[31mMissing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in .env\x1b[0m");
  process.exit(1);
}

const CF_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai`;
const headers = { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" };

const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.5";
let currentModel = DEFAULT_MODEL;
let modelsList = [];
let pendingModelSelect = false;
let messages = [{ role: "system", content: "Welcome to kimitui CLI. Type /help for commands." }];
let streaming = false;
let abortController = null;

function print(msg, color = "") {
  console.log(color + msg + "\x1b[0m");
}

function printPrompt() {
  process.stdout.write("\x1b[32m$\x1b[0m ");
}

async function streamChat(model, userMessage) {
  abortController = new AbortController();
  streaming = true;

  messages.push({ role: "user", content: userMessage });
  process.stdout.write("\x1b[33m");

  try {
    const res = await fetch(`${CF_API}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: userMessage }], stream: true }),
      signal: abortController.signal,
    });

    if (!res.body) { print("\nError: No response body", "\x1b[31m"); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith("data: ")) continue;
        const chunk = t.slice(6);
        if (!chunk) continue;
        try {
          const parsed = JSON.parse(chunk);
          const choices = parsed.choices || [];
          if (choices[0]?.finish_reason === "stop") break;
          const content = choices[0]?.delta?.content || "";
          if (content) { process.stdout.write(content); fullContent += content; }
        } catch { }
      }
    }
    process.stdout.write("\x1b[0m\n");
    messages.push({ role: "assistant", content: fullContent });
  } catch (err) {
    if (err.name === "AbortError") {
      print("\n[Stopped]", "\x1b[33m");
    } else {
      print(`\nError: ${err.message}`, "\x1b[31m");
    }
  } finally {
    streaming = false;
    abortController = null;
  }
}

async function fetchModels() {
  print("Fetching models...", "\x1b[36m");
  try {
    const res = await fetch(`${CF_API}/models/search`, { headers });
    const data = await res.json();
    if (!data.success) { print(`Error: ${data.errors?.[0]?.message || "Unknown"}`, "\x1b[31m"); return; }
    const textGenTask = "c329a1f9-323d-4e91-b2aa-582dd4188d34";
    modelsList = [...new Set(
      (data.result || [])
        .filter(m => m.task?.id === textGenTask)
        .map(m => m.name)
    )].sort();
    pendingModelSelect = true;
    print("Available models:", "\x1b[36m");
    modelsList.forEach((m, i) => print(`  ${i + 1}. ${m}`, "\x1b[36m"));
    print("Type a number to select, or /model <name>", "\x1b[36m");
  } catch (err) {
    print(`Failed to fetch models: ${err.message}`, "\x1b[31m");
  }
}

async function handleCommand(cmd) {
  const parts = cmd.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case "/help":
      print([
        "Available commands:",
        "  /help           Show this help",
        "  /models         List available models by number",
        "  /model <name>   Select a model by name or number",
        "  /info <model>   Show model details",
        "  /clear          Clear the chat",
        "  /stop           Stop streaming",
        "",
        `Current model: ${currentModel}`,
        "Type any message to chat with the selected model.",
      ].join("\n"), "\x1b[36m");
      break;

    case "/models":
      await fetchModels();
      break;

    case "/model":
      if (args.length === 0) { print("Usage: /model <name> or /model <number>", "\x1b[36m"); break; }
      selectModel(args.join(" "));
      break;

    case "/info": {
      if (args.length === 0) { print("Usage: /info <model_name>", "\x1b[36m"); break; }
      const modelName = args.join(" ");
      print(`Fetching info for ${modelName}...`, "\x1b[36m");
      try {
        const res = await fetch(`${CF_API}/models/search`, { headers });
        const data = await res.json();
        if (!data.success) { print("Failed to fetch models", "\x1b[31m"); break; }
        const found = (data.result || []).find(m => m.name === modelName);
        if (!found) { print(`Model '${modelName}' not found`, "\x1b[31m"); break; }
        print(`Model: ${found.name}`, "\x1b[36m");
        print(`Task: ${found.task?.name || "text-generation"}`, "\x1b[36m");
      } catch (err) {
        print(`Failed: ${err.message}`, "\x1b[31m");
      }
      break;
    }

    case "/clear":
      print("Chat cleared.", "\x1b[36m");
      break;

    case "/stop":
      if (abortController) { abortController.abort(); print("Streaming stopped.", "\x1b[33m"); }
      else { print("No active stream to stop.", "\x1b[36m"); }
      break;

    default:
      print(`Unknown command: ${command}. Type /help for commands.`, "\x1b[36m");
  }
}

function selectModel(value) {
  const num = parseInt(value, 10);
  if (!isNaN(num) && num > 0 && num <= modelsList.length) {
    currentModel = modelsList[num - 1];
    pendingModelSelect = false;
    print(`Selected model: ${currentModel}`, "\x1b[36m");
  } else {
    currentModel = value;
    pendingModelSelect = false;
    print(`Selected model: ${currentModel}`, "\x1b[36m");
  }
}

print("kimitui CLI — Terminal chat with Cloudflare AI", "\x1b[32m");
print(`Default model: ${DEFAULT_MODEL}\n`, "\x1b[32m");
printPrompt();

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed || streaming) { printPrompt(); return; }

  if (trimmed.startsWith("/")) {
    await handleCommand(trimmed);
    printPrompt();
    return;
  }

  const num = parseInt(trimmed, 10);
  if (pendingModelSelect && !isNaN(num) && num > 0 && num <= modelsList.length) {
    selectModel(trimmed);
    printPrompt();
    return;
  }

  if (currentModel) {
    await streamChat(currentModel, trimmed);
  } else {
    print("No model selected. Use /models and /model <name>", "\x1b[36m");
  }
  printPrompt();
});

rl.on("close", () => process.exit(0));
