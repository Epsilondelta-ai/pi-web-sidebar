export function movableSiblings(source: HTMLElement): HTMLElement[] {
  if (source.classList.contains("workspace-group")) {
    return [...source.parentElement?.querySelectorAll<HTMLElement>(".workspace-group[data-workspace-group]") || []];
  }

  return [...source.parentElement?.querySelectorAll<HTMLElement>(".session-row[data-session]") || []];
}

export function measureTops(elements: HTMLElement[]): Map<HTMLElement, number> {
  return new Map(elements.map((element: HTMLElement): [HTMLElement, number] => {
    return [element, element.getBoundingClientRect?.().top || 0];
  }));
}

export function animateMovedSiblings(elements: HTMLElement[], before: Map<HTMLElement, number>): void {
  scheduleFrame((): void => {
    for (const element of elements) {
      const oldTop: number = before.get(element) || 0;
      const newTop: number = element.getBoundingClientRect?.().top || 0;
      const delta: number = oldTop - newTop;

      if (!delta) {
        continue;
      }

      animateMovedElement(element, delta);
    }
  });
}

function animateMovedElement(element: HTMLElement, delta: number): void {
  if (typeof element.animate === "function") {
    element.animate([
      { transform: `translateY(${delta}px)` },
      { transform: "translateY(0)" },
    ], { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    return;
  }

  element.style.transform = `translateY(${delta}px)`;
  element.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
  scheduleFrame((): void => {
    element.style.transform = "";
  });
}

function scheduleFrame(callback: () => void): void {
  const frame: ((callback: FrameRequestCallback) => number) | undefined = globalThis.requestAnimationFrame || window?.requestAnimationFrame;

  if (typeof frame === "function") {
    frame(callback);
    return;
  }

  setTimeout(callback, 0);
}
