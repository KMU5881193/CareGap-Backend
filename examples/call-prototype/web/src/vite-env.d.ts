/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CALL_API_BASE?: string;
  readonly VITE_CALL_WS_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
