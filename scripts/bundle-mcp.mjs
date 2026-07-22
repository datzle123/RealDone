import { build } from "esbuild";

await build({
  entryPoints: ["src/mcp/sdk-adapter.ts"],
  outfile: "dist/mcp/sdk-adapter.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  legalComments: "eof",
});
