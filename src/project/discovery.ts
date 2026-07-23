import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  databaseFiles: string[];
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

const SKIP_DIRECTORIES = new Set([
  ".git", ".gradle", ".next", ".nuxt", ".svelte-kit", ".venv",
  "build", "coverage", "dist", "node_modules", "out", "target", "venv",
]);

async function readPackage(root: string): Promise<PackageJson> {
  try {
    return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as PackageJson;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
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
  if (files.has("package.json")) return "npm";
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

interface RuntimeHint {
  framework: string;
  command: RuntimeCommand;
  port: number;
}

function staticServerCommand(projectRoot: string, port: number): RuntimeCommand {
  return {
    executable: process.execPath,
    args: [fileURLToPath(new URL("../runtime/static-server.js", import.meta.url)), "--root", projectRoot, "--port", String(port)],
    source: "static index.html",
  };
}

async function availableStaticPort(preferred = 4173): Promise<number> {
  const bind = (port: number) => new Promise<number | undefined>((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    server.unref();
    server.once("error", () => finish(undefined));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      const address = server.address();
      const selected = address && typeof address !== "string" ? address.port : undefined;
      server.close(() => finish(selected));
    });
  });
  return await bind(preferred) ?? await bind(0) ?? Promise.reject(new Error("No local port is available for the static project runtime."));
}

async function pythonExecutable(projectRoot: string): Promise<string> {
  const relative = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
  const environments = [process.env.VIRTUAL_ENV, path.join(projectRoot, ".venv"), path.join(projectRoot, "venv")]
    .filter((value): value is string => Boolean(value));
  for (const environment of environments) {
    const candidate = path.join(environment, relative);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next conventional interpreter location.
    }
  }
  return process.platform === "win32" ? "py" : "python3";
}

async function readSourceHint(projectRoot: string, file: string): Promise<string> {
  try {
    return (await readFile(path.join(projectRoot, file), "utf8")).slice(0, 1_000_000);
  } catch {
    return "";
  }
}

function portFromText(text: string, fallback: number): number {
  const match = text.match(/(?:--port(?:=|\s+)|\bPORT\s*=\s*|:\s*)(\d{2,5})/i);
  return match?.[1] ? Number(match[1]) : fallback;
}

async function detectConventionalRuntime(projectRoot: string, files: Set<string>): Promise<RuntimeHint | undefined> {
  if (files.has("manage.py")) {
    const python = await pythonExecutable(projectRoot);
    return {
      framework: "Django",
      command: {
        executable: python,
        args: ["manage.py", "runserver", "127.0.0.1:8000", "--noreload"],
        source: "manage.py",
      },
      port: 8000,
    };
  }

  const pythonFile = files.has("main.py") ? "main.py" : files.has("app.py") ? "app.py" : undefined;
  if (pythonFile) {
    const source = await readSourceHint(projectRoot, pythonFile);
    const moduleName = pythonFile.replace(/\.py$/, "");
    if (/\bFastAPI\s*\(/.test(source) || /\bfrom\s+fastapi\b|\bimport\s+fastapi\b/.test(source)) {
      const python = await pythonExecutable(projectRoot);
      return {
        framework: "FastAPI",
        command: {
          executable: python,
          args: ["-m", "uvicorn", `${moduleName}:app`, "--host", "127.0.0.1", "--port", "8000"],
          source: pythonFile,
        },
        port: 8000,
      };
    }
    if (/\bFlask\s*\(/.test(source) || /\bfrom\s+flask\b|\bimport\s+flask\b/.test(source)) {
      const python = await pythonExecutable(projectRoot);
      return {
        framework: "Flask",
        command: {
          executable: python,
          args: ["-m", "flask", "--app", moduleName, "run", "--host", "127.0.0.1", "--port", "5000"],
          source: pythonFile,
        },
        port: 5000,
      };
    }
  }

  if (files.has("artisan")) {
    return {
      framework: "Laravel",
      command: {
        executable: "php",
        args: ["artisan", "serve", "--host=127.0.0.1", "--port=8000"],
        source: "artisan",
      },
      port: 8000,
    };
  }

  if (files.has("deno.json")) {
    try {
      const deno = JSON.parse(await readSourceHint(projectRoot, "deno.json")) as { tasks?: Record<string, string> };
      const task = findScript(deno.tasks ?? {}, ["dev", "start", "serve"]);
      if (task) {
        return {
          framework: "Deno web application",
          command: { executable: "deno", args: ["task", task], source: `deno.json#tasks.${task}` },
          port: portFromText(deno.tasks?.[task] ?? "", 8000),
        };
      }
    } catch {
      // A malformed deno.json is not used as a runtime hint; other conventions remain available.
    }
  }

  if (files.has("bin/rails")) {
    return {
      framework: "Ruby on Rails",
      command: {
        executable: "ruby",
        args: ["bin/rails", "server", "-b", "127.0.0.1", "-p", "3000"],
        source: "bin/rails",
      },
      port: 3000,
    };
  }

  const dotnetProject = [...files].filter((file) => !file.includes("/") && file.endsWith(".csproj")).sort()[0];
  if (dotnetProject) {
    return {
      framework: "ASP.NET Core",
      command: {
        executable: "dotnet",
        args: ["run", "--project", dotnetProject, "--urls", "http://127.0.0.1:5000"],
        source: dotnetProject,
      },
      port: 5000,
    };
  }

  if ((files.has("mvnw") || files.has("mvnw.cmd")) && files.has("pom.xml")) {
    return {
      framework: "Spring Boot",
      command: {
        executable: path.join(projectRoot, process.platform === "win32" && files.has("mvnw.cmd") ? "mvnw.cmd" : "mvnw"),
        args: ["spring-boot:run"],
        source: "Maven wrapper",
      },
      port: 8080,
    };
  }

  if ((files.has("gradlew") || files.has("gradlew.bat")) && (files.has("build.gradle") || files.has("build.gradle.kts"))) {
    return {
      framework: "Spring Boot",
      command: {
        executable: path.join(projectRoot, process.platform === "win32" && files.has("gradlew.bat") ? "gradlew.bat" : "gradlew"),
        args: ["bootRun"],
        source: "Gradle wrapper",
      },
      port: 8080,
    };
  }

  if (files.has("go.mod")) {
    return {
      framework: "Go web application",
      command: { executable: "go", args: ["run", "."], source: "go.mod" },
      port: 8080,
    };
  }

  if (files.has("Cargo.toml")) {
    const cargo = await readSourceHint(projectRoot, "Cargo.toml");
    const port = /\brocket\b/i.test(cargo) ? 8000 : /\bactix-web\b/i.test(cargo) ? 8080 : 3000;
    return {
      framework: /\brocket\b/i.test(cargo) ? "Rocket" : /\bactix-web\b/i.test(cargo) ? "Actix Web" : /\baxum\b/i.test(cargo) ? "Axum" : "Rust web application",
      command: { executable: "cargo", args: ["run"], source: "Cargo.toml" },
      port,
    };
  }

  if (files.has("composer.json")) {
    try {
      const composer = JSON.parse(await readSourceHint(projectRoot, "composer.json")) as { scripts?: Record<string, string | string[]> };
      const scripts = Object.fromEntries(Object.entries(composer.scripts ?? {}).map(([name, value]) => [name, Array.isArray(value) ? value.join(" ") : value]));
      const script = findScript(scripts, ["dev", "start", "serve"]);
      if (script) {
        return {
          framework: "PHP web application",
          command: { executable: "composer", args: ["run-script", script], source: `composer.json#scripts.${script}` },
          port: portFromText(scripts[script] ?? "", 8000),
        };
      }
    } catch {
      // A malformed composer.json is ignored as a hint and reported by the selected runtime if used directly.
    }
  }

  if (files.has("index.html")) {
    const port = await availableStaticPort();
    return { framework: "Static HTML", command: staticServerCommand(projectRoot, port), port };
  }
  return undefined;
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
  if (file.endsWith(".html")) {
    const route = `/${file.replace(/\.html$/, "")}`.replace(/\/index$/, "").replace(/\/+$/, "");
    return route || "/";
  }
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
  const fileSet = new Set(files);
  const conventionalRuntime = await detectConventionalRuntime(projectRoot, fileSet);
  const detectedFramework = framework === "Unknown web framework" ? conventionalRuntime?.framework ?? framework : framework;
  const developmentScript = findScript(scripts, ["dev", "start:dev", "start"]);
  const productionScript = findScript(scripts, ["start", "preview", "serve"]);
  const buildScript = findScript(scripts, ["build", "build:production"]);
  const developmentCommand = developmentScript ? scriptCommand(packageManager, developmentScript) : conventionalRuntime?.command;
  const productionCommand = productionScript ? scriptCommand(packageManager, productionScript) : undefined;
  const buildCommand = buildScript ? scriptCommand(packageManager, buildScript) : undefined;
  const port = developmentScript
    ? detectPort([scripts, ...workspacePackages.map((value) => value.scripts ?? {})], detectedFramework)
    : conventionalRuntime?.port ?? detectPort([scripts, ...workspacePackages.map((value) => value.scripts ?? {})], detectedFramework);
  const routes = [...new Set(files.map(routeFromFile).filter((route): route is string => Boolean(route)))].sort().slice(0, 200);
  const environmentFiles = files.filter((file) => /^\.env(?:\.[\w-]+)?(?:\.example|\.sample)?$/.test(file)).sort();
  const databaseFiles = files.filter((file) => /(?:^|\/)[^/]+\.(?:db|sqlite|sqlite3)$/i.test(file)).sort().slice(0, 100);
  const docker = topFiles.has("Dockerfile") || topFiles.has("docker-compose.yml") || topFiles.has("compose.yml") || topFiles.has("compose.yaml");
  const healthEndpoint = routes.find((route) => /\/(?:api\/)?health$/.test(route)) ?? "/";

  return {
    schemaVersion: "1.0",
    projectRoot,
    discoveredAt: new Date().toISOString(),
    framework: detectedFramework,
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
    databaseFiles,
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
