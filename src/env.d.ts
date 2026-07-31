/// <reference types="astro/client" />

declare global {
  interface Window {
    tmInitSmartSearch?: () => void;
  }
}

export {};
