/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly GEMINI_API_KEY?: string;
  readonly VITE_GOOGLE_API_KEY?: string;
  readonly GOOGLE_API_KEY?: string;
  readonly GOOGLE_GENAI_API_KEY?: string;
  readonly VITE_API_KEY?: string;
  readonly API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
