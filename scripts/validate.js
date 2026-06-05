import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const entryUrl = new URL(`../${manifest.entry}`, import.meta.url);
const entry = readFileSync(entryUrl, "utf8");
const entryModule = await import(entryUrl.href);

const failures = [];

if (manifest.id !== "pi-web-sidebar") {
  failures.push("plugin id must be pi-web-sidebar");
}

if (!manifest.entry || manifest.entry !== "index.js") {
  failures.push("plugin entry must be index.js");
}

if (typeof entryModule.default !== "function") {
  failures.push("entry must export default activate function");
}

if (typeof entryModule.createSidebarController !== "function") {
  failures.push("entry must export createSidebarController function");
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
