/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_REVIEW_PACKETS?: string
  readonly VITE_ENABLE_RESUME_AI_SUMMARY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
