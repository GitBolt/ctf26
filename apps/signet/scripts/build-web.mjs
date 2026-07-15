import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const STARTER = path.join(ROOT, "starter");
const OUTPUT = path.join(PUBLIC, "signet-starter.tar.gz");

for (const filename of ["index.html", "styles.css", "app.js"]) {
  const fullPath = path.join(PUBLIC, filename);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size < 100) {
    throw new Error(`public/${filename} is missing or empty`);
  }
}

const files = walk(STARTER).sort();
if (!files.some((file) => file.relative === "README.md")) throw new Error("starter README is missing");
const tar = Buffer.concat([
  ...files.map((file) => tarEntry(`signet-starter/${file.relative}`, fs.readFileSync(file.absolute))),
  Buffer.alloc(1024),
]);
fs.writeFileSync(OUTPUT, zlib.gzipSync(tar, { level: 9, mtime: 0 }));
console.log(`Built player interface and ${path.relative(ROOT, OUTPUT)} (${files.length} starter files)`);

function walk(directory, prefix = "") {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "target" || entry.name.startsWith(".")) {
      if (entry.name !== ".env.example") continue;
    }
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute, relative));
    else if (entry.isFile()) result.push({ absolute, relative });
  }
  return result;
}

function tarEntry(name, content) {
  const header = Buffer.alloc(512, 0);
  writeText(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, content.length, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, "ustar\0", 257, 6);
  writeText(header, "00", 263, 2);
  writeText(header, "ctf26", 265, 32);
  writeText(header, "ctf26", 297, 32);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeText(header, `${checksumText}\0 `, 148, 8);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512, 0);
  return Buffer.concat([header, content, padding]);
}

function writeText(buffer, value, offset, length) {
  Buffer.from(value).copy(buffer, offset, 0, length);
}

function writeOctal(buffer, value, offset, length) {
  const text = value.toString(8).padStart(length - 1, "0") + "\0";
  writeText(buffer, text, offset, length);
}
