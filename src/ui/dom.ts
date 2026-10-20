/** Sammelt alle Elemente mit `data-ref="name"` unterhalb von `root` in einem Objekt. */
export function collectRefs<K extends string>(root: HTMLElement, names: readonly K[]): Record<K, HTMLElement> {
  const refs = {} as Record<K, HTMLElement>;
  for (const name of names) {
    const el = root.querySelector<HTMLElement>(`[data-ref="${name}"]`);
    if (!el) throw new Error(`UI-Element [data-ref="${name}"] fehlt`);
    refs[name] = el;
  }
  return refs;
}
