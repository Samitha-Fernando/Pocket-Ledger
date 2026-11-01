// Compiles the app's Tailwind stylesheet into plain CSS for the Claude Design
// sync. Output: .design-sync/.cache/ds-compiled.css (git-ignored).
// Run from the repo root: node .design-sync/build-css.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const src = resolve(".design-sync/styles.src.css");
const out = resolve(".design-sync/.cache/ds-compiled.css");
const result = await postcss([tailwind({ base: process.cwd() })]).process(readFileSync(src, "utf8"), { from: src, to: out });
const fonts = '@import url("https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap");\n';
mkdirSync(resolve(".design-sync/.cache"), { recursive: true });
writeFileSync(out, fonts + result.css);
console.log(`wrote ${out} (${result.css.length} bytes)`);
