/**
 * Lazy loader for the big @ai-gaem/parts library (its own chunk, fetched after the game is
 * playable). Until it arrives buildWeaponModel() renders a simple placeholder from the built-in
 * kit; listeners registered with onPartsLibrary() rebuild their models once it's in.
 */
export type PartsLibrary = typeof import('./partsLibraryImpl');

let lib: PartsLibrary | null = null;
let loading: Promise<PartsLibrary> | null = null;
const listeners = new Set<() => void>();

/** the library if it has loaded, else null (never triggers a load) */
export function partsLibrary(): PartsLibrary | null {
  return lib;
}

export function loadPartsLibrary(): Promise<PartsLibrary> {
  loading ??= import('./partsLibraryImpl').then(
    (m) => {
      lib = m;
      for (const cb of listeners) {
        try {
          cb();
        } catch (err) {
          console.error('[parts] listener failed', err);
        }
      }
      return m;
    },
    (err) => {
      loading = null; // allow a retry
      throw err;
    },
  );
  return loading;
}

/** called once the library has loaded (not called if it already has); returns an unsubscribe */
export function onPartsLibrary(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
