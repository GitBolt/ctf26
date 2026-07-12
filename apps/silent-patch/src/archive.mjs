import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../repo");
const ALLOWED_EXTENSIONS = new Set([".md", ".rs", ".diff", ".json", ".toml"]);
const MAX_FILE_BYTES = 160_000;

async function walk(directory, prefix = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, relative));
    else if (entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

function categoryFor(relative) {
  if (relative.startsWith("prs/")) return "Pull requests";
  if (relative.startsWith("issues/")) return "Issues";
  if (relative.startsWith("current/")) return "Current source";
  if (relative.startsWith("commits/")) return "Commits";
  return "Project";
}

function titleFor(content, relative) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || path.basename(relative);
}

export async function archiveManifest() {
  const files = (await walk(ROOT)).sort((left, right) => left.localeCompare(right));
  return Promise.all(files.map(async (relative) => {
    const absolute = path.join(ROOT, relative);
    const stat = await fs.stat(absolute);
    const content = await fs.readFile(absolute, "utf8");
    return {
      path: relative,
      title: titleFor(content, relative),
      category: categoryFor(relative),
      size: stat.size,
    };
  }));
}

export async function archiveFile(relative) {
  if (typeof relative !== "string" || relative.length > 240 || relative.includes("\\")) return null;
  const normalized = path.posix.normalize(relative).replace(/^\/+/, "");
  if (normalized.startsWith("../") || !ALLOWED_EXTENSIONS.has(path.extname(normalized))) return null;
  const allowed = await archiveManifest();
  if (!allowed.some((file) => file.path === normalized)) return null;
  const absolute = path.join(ROOT, normalized);
  const stat = await fs.stat(absolute);
  if (stat.size > MAX_FILE_BYTES) return null;
  return {
    path: normalized,
    title: titleFor(await fs.readFile(absolute, "utf8"), normalized),
    content: await fs.readFile(absolute, "utf8"),
    category: categoryFor(normalized),
  };
}
