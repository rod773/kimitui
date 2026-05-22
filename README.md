# kimitui

Terminal-style web interface for chatting with AI models via **Cloudflare Workers AI**. Dark background, green monospace text, streaming responses — feels like a terminal.

## Stack

- **Frontend:** Next.js 16 (App Router) + Tailwind CSS + TypeScript
- **Backend:** Next.js API routes call Cloudflare Workers AI API (OpenAI-compatible) directly via `fetch`
- **Package manager:** yarn

## Requirements

- Node.js 20.9+
- A [Cloudflare](https://cloudflare.com) account with Workers AI enabled
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`

## Setup

```bash
# 1. Clone and install
git clone https://github.com/rod773/kimitui
cd kimitui
yarn install

# 2. Create .env with your Cloudflare credentials
cp .env_example .env
# Edit .env and fill in your CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN

# 3. Run dev server
yarn dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command | Description |
|---|---|
| `/help` | Show all available commands |
| `/models` | List available models with numbers |
| `/model <name or #>` | Select a model by name or number |
| `/info <model>` | Show model details |
| `/clear` | Clear the chat |
| `/stop` | Stop streaming response (also `Esc` key) |

After running `/models`, just type a number to select that model.

## Features

- Streaming responses via Server-Sent Events (SSE)
- Esc key to abort streaming
- Model selection persists in `localStorage`
- Default model: `@cf/moonshotai/kimi-k2.5`
- Header bar with model name, thinking indicator, and command list

## API

All requests go through `POST /api/chat` with NDJSON responses.

Actions: `list_families`, `list_models`, `model_info`, `chat`, `stream_chat`.

## Deployment

```bash
vercel --prod
```

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as environment variables in the Vercel project settings.
