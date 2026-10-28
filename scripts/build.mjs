import { build } from "esbuild";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const bytes = await readFile("public/data/variants.json");
const data = JSON.parse(bytes);
if (
  data.schemaVersion !== "1.0.0" ||
  data.variants.length !== data.summary.variants
)
  throw new Error("Invalid preprocessed dataset; run npm run data");
for (const [file, expected] of [
  ["Q02388.json", data.sources.uniprot.sha256],
  ["public/data/clinvar-col7a1.tsv", data.sources.clinvar.extractedSha256],
]) {
  if (
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex") !== expected
  )
    throw new Error(`Source hash mismatch: ${file}`);
}
await mkdir("dist/assets", { recursive: true });
await cp("public", "dist", { recursive: true });
await copyFile("Q02388.json", "dist/data/Q02388.json");
await copyFile("index.html", "dist/index.html");
await build({
  entryPoints: ["src/app.jsx"],
  outfile: "dist/assets/app.js",
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  logLevel: "info",
});
const licenses = await Promise.all(
  ["react", "react-dom", "scheduler"].map(
    async (name) =>
      `${name}\n${await readFile(path.join("node_modules", name, "LICENSE"), "utf8")}`,
  ),
);
await writeFile("dist/THIRD-PARTY-LICENSES.txt", licenses.join("\n\n"));
console.log(
  `Static build: dist/ · ${data.summary.variants} variants · no runtime API or external assets`,
);
