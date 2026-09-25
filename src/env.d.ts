interface ImportMetaEnv {
  /** Where the dashboard reads the books from. Defaults to a local api-vista. */
  readonly VITE_API_BASE_URL?: string
  /** '1' runs on the generated demo history with no server. Never set in production. */
  readonly VITE_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
