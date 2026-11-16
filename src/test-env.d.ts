// Nur für Tests: schmale Typen statt @types/node, damit der Plugin-Code keine Node-Typen sieht
// (Node-Built-ins sind im Bundle verboten, build.mjs prüft das).
declare module 'node:fs' {
  export function readFileSync(path: URL | string): Uint8Array
}
