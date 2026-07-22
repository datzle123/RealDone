import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RuntimeCommand {
  executable: string;
  args: string[];
  source: string;
}

export interface ProjectProfile {
  schemaVersion: "1.0";
  projectRoot: string;
  discoveredAt: string;
  framework: string;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  commands: {
    development?: RuntimeCommand;
    build?: RuntimeCommand;
    production?: RuntimeCommand;
    docker?: RuntimeCommand;
  };
  port: number;
  localUrl: string;
  healthEndpoint: string;
  routes: string[];
  databases: string[];
  authProviders: string[];
  testFrameworks: string[];
  environmentFiles: string[];
  docker: boolean;
}

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const SKIP_DIRECTORIES = new Set([".git", ".next", ".nuxt", ".svelte-kit", "build", "coverage", "dist", "node_modules", "out"]);

async function readPackage(root: string): Promise<PackageJson> {
  try {
    return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as PackageJson;
  } catch (error) {
    throw new Error(`No readable package.json was found in ${root}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageManagerFrom(packageJson: PackageJson, files: Set<string>): ProjectProfile["packageManager"] {
  const declared = packageJson.packageManager?.split("@")[0];
  if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") return declared;
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lock") || files.has("bun.lockb")) return "bun";
  if (files.has("package-lock.json") || files.has("npm-shrinkwrap.json")) return "npm";
  return "unknown";
}

function scriptCommand(
  packageManager: ProjectProfile["packageManager"],
  script: string,
): RuntimeCommand | undefined {
  if (packageManager === "unknown") return undefined;
  return {
    executable: packageManager,
    args: packageManager === "npm" || packageManager === "bun" ? ["run", script] : [script],
    source: `package.json#scripts.${script}`,
  };
}

function findScript(scripts: Record<string, string>, candidates: string[]): string | undefined {
  return candidates.find((candidate) => scripts[candidate]);
}

function detectFramework(dependencies: Record<string, string>): string {
  const candidates: Array<[string, string[]]> = [
    ["Next.js", ["next"]],
    ["Nuxt", ["nuxt"]],
    ["SvelteKit", ["@sveltejs/kit"]],
    ["Angular", ["@angular/core"]],
    ["Astro", ["astro"]],
    ["Remix", ["@remix-run/react"]],
    ["Vite + React", ["vite", "react"]],
    ["Vite", ["vite"]],
    ["Create React App", ["react-scripts"]],
    ["Express", ["express"]],
  ];
  return candidates.find(([, packages]) => packages.every((name) => dependencies[name]))?.[0] ?? "Unknown web framework";
}

function detectPort(scriptGroups: Array<Record<string, string>>, framework: string): number {
  const text = scriptGroups.flatMap((scripts) => Object.values(scripts)).join("\n");
  const match = text.match(/(?:--port(?:=|\s+)|\bPORT\s*=\s*)(\d{2,5})/i);
  if (match?.[1]) return Number(match[1]);
  if (/Vite|SvelteKit|Astro/.test(framework)) return 5173;
  if (framework === "Angular") return 4200;
  return 3000;
}

async function directWorkspacePackages(root: string): Promise<PackageJson[]> {
  const packageFiles: string[] = [];
  for (const base of ["packages", "apps"]) {
    const directory = path.join(root, base);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    packageFiles.push(...entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name, "package.json")));
  }
  return Promise.all(packageFiles.map(async (file): Promise<PackageJson> => {
    try {
      return JSON.parse(await readFile(file, "utf8")) as PackageJson;
    } catch {
      return {};
    }
  }));
}

async function collectFiles(root: string, limit = 2_000): Promise<string[]> {
  const output: string[] = [];
  const queue = [root];
  while (queue.length > 0 && output.length < limit) {
    const directory = queue.shift();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= limit) break;
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) queue.push(path.join(directory, entry.name));
      } else if (entry.isFile()) {
        output.push(path.relative(root, path.join(directory, entry.name)).split(path.sep).join("/"));
      }
    }
  }
  return output;
}

function routeFromFile(file: string): string | undefined {
  const normalized = file.replace(/\.(?:[cm]?[jt]sx?|vue|svelte)$/, "");
  const app = normalized.match(/(?:^|\/)app\/(.+)\/(?:page|route)$/);
  const page = normalized.match(/(?:^|\/)pages\/(.+)$/);
  const source = app?.[1] ?? page?.[1];
  if (!source || /(?:^|\/)_(?:app|document|error)$/.test(source)) return undefined;
  const route = `/${source}`
    .replace(/\/index$/, "")
    .replace(/\/\([^/]+\)/g, "")
    .replace(/\[\.\.\.[^\]]+\]/g, "*")
    .replace(/\[[^\]]+\]/g, ":param")
    .replace(/\/+$/, "") || "/";
  return route;
}

function detectByDependency(dependencies: Record<string, string>, groups: Array<[string, string[]]>): string[] {
  return groups.filter(([, packages]) => packages.some((name) => dependencies[name])).map(([label]) => label);
}

export async function discoverProject(directory = process.cwd()): Promise<ProjectProfile> {
  const projectRoot = path.resolve(directory);
  const [packageJson, topEntries, files] = await Promise.all([
    readPackage(projectRoot),
    readdir(projectRoot).catch(() => []),
    collectFiles(projectRoot),
  ]);
  const [nestedPackages, directPackages] = await Promise.all([
    Promise.all(
    files
      .filter((file) => file !== "package.json" && file.endsWith("/package.json"))
      .slice(0, 100)
      .map((file) => readPackage(path.join(projectRoot, path.dirname(file))).catch((): PackageJson => ({}))),
    ),
    directWorkspacePackages(projectRoot),
  ]);
  const workspacePackages = [...nestedPackages, ...directPackages];
  const topFiles = new Set(topEntries);
  const packageManager = packageManagerFrom(packageJson, topFiles);
  const scripts = packageJson.scripts ?? {};
  const dependencies = Object.assign(
    {},
    packageJson.dependencies ?? {},
    packageJson.devDependencies ?? {},
    ...workspacePackages.flatMap((value) => [value.dependencies ?? {}, value.devDependencies ?? {}]),
  ) as Record<string, string>;
  const framework = detectFramework(dependencies);
  const port = detectPort([scripts, ...workspacePackages.map((value) => value.scripts ?? {})], framework);
  const developmentScript = findScript(scripts, ["dev", "start:dev", "start"]);
  const productionScript = findScript(scripts, ["start", "preview", "serve"]);
  const buildScript = findScript(scripts, ["build", "build:production"]);
  const developmentCommand = developmentScript ? scriptCommand(packageManager, developmentScript) : undefined;
  const productionCommand = productionScript ? scriptCommand(packageManager, productionScript) : undefined;
  const buildCommand = buildScript ? scriptCommand(packageManager, buildScript) : undefined;
  const routes = [...new Set(files.map(routeFromFile).filter((route): route is string => Boolean(route)))].sort().slice(0, 200);
  const environmentFiles = files.filter((file) => /^\.env(?:\.[\w-]+)?(?:\.example|\.sample)?$/.test(file)).sort();
  const docker = topFiles.has("Dockerfile") || topFiles.has("docker-compose.yml") || topFiles.has("compose.yml") || topFiles.has("compose.yaml");
  const healthEndpoint = routes.find((route) => /\/(?:api\/)?health$/.test(route)) ?? "/";

  return {
    schemaVersion: "1.0",
    projectRoot,
    discoveredAt: new Date().toISOString(),
    framework,
    packageManager,
    commands: {
      ...(developmentCommand ? { development: developmentCommand } : {}),
      ...(buildCommand ? { build: buildCommand } : {}),
      ...(productionCommand ? { production: productionCommand } : {}),
      ...(docker ? { docker: { executable: "docker", args: ["compose", "up"], source: "compose file" } } : {}),
    },
    port,
    localUrl: `http://127.0.0.1:${port}`,
    healthEndpoint,
    routes,
    databases: detectByDependency(dependencies, [
      ["SQLite", ["sqlite", "sqlite3", "better-sqlite3"]],
      ["PostgreSQL", ["pg", "postgres"]],
      ["Prisma", ["prisma", "@prisma/client"]],
      ["Supabase", ["@supabase/supabase-js"]],
      ["Firebase", ["firebase", "firebase-admin"]],
      ["MongoDB", ["mongodb", "mongoose"]],
    ]),
    authProviders: detectByDependency(dependencies, [
      ["Auth.js/NextAuth", ["next-auth", "@auth/core"]],
      ["Clerk", ["@clerk/nextjs", "@clerk/clerk-react"]],
      ["Auth0", ["@auth0/nextjs-auth0", "@auth0/auth0-react"]],
      ["Supabase Auth", ["@supabase/supabase-js"]],
      ["Firebase Auth", ["firebase"]],
      ["Passport", ["passport"]],
    ]),
    testFrameworks: detectByDependency(dependencies, [
      ["Playwright", ["@playwright/test", "playwright"]],
      ["Cypress", ["cypress"]],
      ["Vitest", ["vitest"]],
      ["Jest", ["jest"]],
    ]),
    environmentFiles,
    docker,
  };
}

export async function writeProjectProfile(profile: ProjectProfile, file: string): Promise<string> {
  const output = path.resolve(file);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(profile, null, 2)}\n`);
  return output;
}

export async function loadProjectProfile(file: string): Promise<ProjectProfile> {
  const value = JSON.parse(await readFile(path.resolve(file), "utf8")) as ProjectProfile;
  if (value.schemaVersion !== "1.0" || !value.projectRoot || !value.localUrl) {
    throw new Error(`Invalid RealDone project profile: ${file}`);
  }
  return value;
}
