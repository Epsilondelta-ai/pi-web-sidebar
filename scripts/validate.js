import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const entry = readFileSync(new URL(`../${manifest.entry}`, import.meta.url), "utf8");

const failures = [];

if (manifest.id !== "pi-web-sidebar") {
  failures.push("plugin id must be pi-web-sidebar");
}

if (!manifest.entry || manifest.entry !== "index.js") {
  failures.push("plugin entry must be index.js");
}

if (!entry.includes("export default function activate")) {
  failures.push("entry must export default activate");
}

if (!entry.includes(".app-body")) {
  failures.push("entry must mount under .app-body");
}

if (!entry.includes("data-pi-web-sidebar-plugin")) {
  failures.push("entry must mark plugin sidebar root");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("plugin manifest and entry validated");
