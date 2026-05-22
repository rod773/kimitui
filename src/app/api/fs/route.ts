import { readFile, writeFile, unlink, readdir, stat, mkdir } from "fs/promises";
import { join, isAbsolute, normalize, relative } from "path";

const PROJECT_ROOT = process.cwd();

function sanitizePath(userPath: string): string {
  const resolved = isAbsolute(userPath)
    ? normalize(userPath)
    : join(PROJECT_ROOT, normalize(userPath));
  const rel = relative(PROJECT_ROOT, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside project root");
  }
  return resolved;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, path, content, oldString, newString } = body;

    if (!path) {
      return Response.json({ type: "error", message: "path is required" }, { status: 400 });
    }

    const safePath = sanitizePath(path);

    switch (action) {
      case "read": {
        const data = await readFile(safePath, "utf-8");
        return Response.json({ type: "result", data });
      }

      case "write": {
        if (content === undefined) {
          return Response.json({ type: "error", message: "content is required for write" }, { status: 400 });
        }
        await mkdir(safePath.split("\\").slice(0, -1).join("\\"), { recursive: true });
        await writeFile(safePath, content, "utf-8");
        return Response.json({ type: "result", message: `Written ${safePath}` });
      }

      case "edit": {
        if (!oldString) {
          return Response.json({ type: "error", message: "oldString is required for edit" }, { status: 400 });
        }
        const data = await readFile(safePath, "utf-8");
        if (!data.includes(oldString)) {
          return Response.json({ type: "error", message: "oldString not found in file" }, { status: 404 });
        }
        const newData = newString !== undefined ? data.replace(oldString, newString) : data.replace(oldString, "");
        await writeFile(safePath, newData, "utf-8");
        return Response.json({ type: "result", message: `Edited ${safePath}` });
      }

      case "delete": {
        await unlink(safePath);
        return Response.json({ type: "result", message: `Deleted ${safePath}` });
      }

      case "ls": {
        const entries = await readdir(safePath, { withFileTypes: true });
        const listing = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
          size: e.isFile() ? 0 : undefined,
        }));
        for (const item of listing) {
          if (item.type === "file") {
            try {
              const s = await stat(join(safePath, item.name));
              item.size = s.size;
            } catch {}
          }
        }
        return Response.json({ type: "result", data: listing });
      }

      default:
        return Response.json({ type: "error", message: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return Response.json({
      type: "error",
      message: err instanceof Error ? err.message : "Internal error",
    }, { status: 500 });
  }
}
