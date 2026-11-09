import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    // The voice modules only touch `window.SpeechRecognition` and
    // `window.speechSynthesis`; the tests stub exactly those, so no DOM
    // emulation is needed.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
