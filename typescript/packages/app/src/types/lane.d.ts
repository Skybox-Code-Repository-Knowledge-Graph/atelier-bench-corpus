/**
 * Ambient declaration file for a build-time constant. It has no import or export, so it is a global
 * script, and `declare const` declares a global value that the build defines (vitest.config.ts
 * `define`), not a value any module exports.
 */

declare const __ATELIER_LANE__: string;
