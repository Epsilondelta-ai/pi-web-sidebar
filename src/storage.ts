export function readStoredList(key: string): string[] {
  const value: unknown = readStoredValue(key);
  return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === "string") : [];
}

export function readStoredObject(key: string): Record<string, string[]> {
  const value: unknown = readStoredValue(key);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output: Record<string, string[]> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (Array.isArray(entryValue)) {
      output[entryKey] = entryValue.filter((item: unknown): item is string => typeof item === "string");
    }
  }

  return output;
}

export function readStoredValue(key: string): unknown {
  try {
    const value: string | null = localStorage.getItem(key);
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

export function storeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function storeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
