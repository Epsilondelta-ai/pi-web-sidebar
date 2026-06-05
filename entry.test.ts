import { describe, expect, test } from "bun:test";
import activate, { createSidebarController } from "./index.js";

describe("bundled plugin entry", (): void => {
  test("exports activate and controller factory", (): void => {
    expect(typeof activate).toBe("function");
    expect(typeof createSidebarController).toBe("function");
  });
});
