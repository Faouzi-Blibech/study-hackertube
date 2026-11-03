let cached: boolean | null = null;

/** True when a WebGL context can be created at all (checked once; cheap enough for the main bundle). */
export function webglAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    cached = !!gl;
    (gl as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
