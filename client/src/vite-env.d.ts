/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL (bucket/CDN) for optimized map assets, e.g. https://cdn.example.com/maps */
  readonly VITE_MAP_BASE_URL?: string;
  readonly VITE_SPACETIMEDB_HOST?: string;
  readonly VITE_SPACETIMEDB_DB_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
