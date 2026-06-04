#!/usr/bin/env node
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = dirname(fileURLToPath(import.meta.url));
const binary = resolveBinary();

if (!existsSync(binary)) {
  process.stderr.write(`Unsupported platform or missing backend binary: ${process.platform}/${process.arch}\n`);
  process.stderr.write(`Expected binary at: ${binary}\n`);
  process.exit(1);
}

try {
  chmodSync(binary, 0o755);
} catch {
  // The binary may already be executable or live on a read-only filesystem.
}

const run = spawnSync(binary, process.argv.slice(2), {
  encoding: "utf8",
  input: await readStdin(),
  maxBuffer: 1024 * 1024 * 8,
});

if (run.error) {
  process.stderr.write(`Failed to execute backend binary: ${run.error.message}\n`);
  process.exit(1);
}

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
process.exit(run.status ?? 1);

function resolveBinary() {
  const os = { darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os || !arch) return join(dir, "bin", "unsupported", "pi-web-sidebar-backend");
  return join(dir, "bin", `${os}-${arch}`, "pi-web-sidebar-backend");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
