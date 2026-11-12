// Renames the single-file build to a friendly name and reports its size.
import { renameSync, statSync, readFileSync } from "node:fs";
const from = "dist-preview/preview.html";
const to = "dist-preview/VoxFlow-Preview.html";
renameSync(from, to);
const html = readFileSync(to, "utf8");
const external = [...html.matchAll(/<script[^>]+src="(?!data:)([^"]+)"/g)].map((m) => m[1]);
if (external.length) {
  console.error("External scripts left in preview:", external);
  process.exit(1);
}
console.log(`  ${to}  ${(statSync(to).size / 1024).toFixed(0)} KB, self-contained`);
