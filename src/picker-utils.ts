export function textInputValue(form: HTMLFormElement, name: string): string {
  const input: HTMLInputElement | null = form.querySelector(`[name="${name}"]`);
  return input?.value.trim() || "";
}

export function eventTarget(event: Event): HTMLElement | null {
  const target: EventTarget | null = event.target;
  return target && typeof (target as Element).closest === "function" ? target as HTMLElement : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
