import type { PiWebRegistry } from "./types";

declare global {
  var PI_WEB_API_BASE: string | undefined;
  var piWeb: PiWebRegistry | undefined;
}

export {};
