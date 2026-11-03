import { Color } from 'three';

/**
 * One color per area: hues are spread evenly in the order the areas appear around the galaxy,
 * so neighbours get neighbouring hues. Lightness differs for light and dark pages.
 */
export function areaColors(areaIds: string[], centers: Map<string, [number, number]>, dark: boolean): Map<string, Color> {
  const angle = (id: string): number => {
    const c = centers.get(id) ?? [0, 0];
    return Math.atan2(c[1], c[0]);
  };
  const ordered = [...areaIds].sort((a, b) => angle(a) - angle(b));
  const out = new Map<string, Color>();
  ordered.forEach((id, k) => {
    const hue = ((k / ordered.length) * 0.92 + 0.02) % 1;
    out.set(id, new Color().setHSL(hue, dark ? 0.5 : 0.5, dark ? 0.66 : 0.42));
  });
  return out;
}

/** Resolve a CSS custom property (e.g. --accent) to a three.js color. */
export function cssColor(name: string, fallback: string): Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new Color(v || fallback);
  } catch {
    return new Color(fallback);
  }
}
