#!/usr/bin/env node
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BACKEND_TIMEOUT_MS = 6 * 60 * 1000;
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
  timeout: BACKEND_TIMEOUT_MS,
});

if (run.error) {
  const message = run.error.code === "ETIMEDOUT"
    ? `Backend timed out after ${BACKEND_TIMEOUT_MS / 1000}s`
    : `Failed to execute backend binary: ${run.error.message}`;
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const stdout = run.stdout || "";
const stderr = run.stderr || "";

if ((run.status ?? 1) === 0 && isJson(stdout)) {
  await writeStream(process.stdout, stdout);
  process.exit(0);
}

await writeStream(process.stdout, stdout);
await writeStream(process.stderr, stderr);
process.exit(run.status ?? 1);

function resolveBinary() {
  const os = { darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os || !arch) return join(dir, "bin", "unsupported", "pi-web-sidebar-backend");
  return join(dir, "bin", `${os}-${arch}`, "pi-web-sidebar-backend");
}

function isJson(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function writeStream(stream, value) {
  if (!value) {
    return;
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.off("error", onError);
      stream.off("drain", onDrain);
    };

    stream.once("error", onError);
    if (stream.write(value)) {
      cleanup();
      resolve();
      return;
    }

    stream.once("drain", onDrain);
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
