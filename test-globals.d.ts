declare global {
  interface Element {
    hidden: boolean;
    value: string;
    dataset: DOMStringMap;
    getBoundingClientRect(): DOMRect;
  }

  interface EventTarget {
    closest<E extends Element = Element>(selector: string): E | null;
  }
}

export {};
