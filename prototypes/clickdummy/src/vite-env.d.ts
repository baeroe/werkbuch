/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `hash` in the review build (`.env.review`): the routes live in the hash of the address (HashRouter). */
  readonly VITE_ROUTER?: 'hash';
}
