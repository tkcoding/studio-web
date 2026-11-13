/** jsdom has no ResizeObserver; charts, cmdk and the kit's table measure with one. */
export function stubResizeObserver(): void {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
