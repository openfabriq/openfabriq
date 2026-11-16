// Builds the npm package "openfabriq": the CLI with core, runner and studio bundled in,
// the studio's built app, the Claude Code plugin, the engine's skills, the examples and the relay's sources.
// Run by `pnpm package`, after `pnpm build`. Writes packages/cli/release/openfabriq-<version>.tgz.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const ROOT = join(import.meta.dirname, "../../..");
const OUT = join(ROOT, "packages/cli/release");
const STAGE = join(OUT, "openfabriq");
// The project's repository: the root package.json's, or OPENFABRIQ_REPOSITORY (owner/name) for a fork.
const REPOSITORY =
	process.env.OPENFABRIQ_REPOSITORY ??
	(
		JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
			repository: string;
		}
	).repository.replace(/^github:/, "");
const manifest = (pkg: string) =>
	JSON.parse(
		readFileSync(join(ROOT, "packages", pkg, "package.json"), "utf8"),
	) as { version: string; dependencies: Record<string, string> };

// The engine's third-party dependencies stay npm dependencies, at the versions the workspace pins.
// The studio's are the app's, already built into dist/app.
const dependencies = Object.fromEntries(
	["core", "runner"]
		.flatMap((pkg) => Object.entries(manifest(pkg).dependencies))
		.filter(([name]) => !name.startsWith("@openfabriq/")),
);

rmSync(OUT, { recursive: true, force: true });
await build({
	entryPoints: [join(ROOT, "packages/cli/dist/index.js")],
	outfile: join(STAGE, "dist/index.js"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	external: Object.keys(dependencies),
	logLevel: "warning",
});

const copy = (from: string, to = from) =>
	cpSync(join(ROOT, from), join(STAGE, to), { recursive: true });
copy("packages/studio/dist/app", "dist/app");
copy("packages/cli/plugin", "plugin");
// The engine's own skills, which runner finds beside dist/.
copy("packages/runner/skills", "skills");
copy("examples");
for (const file of [
	"package.json",
	"wrangler.jsonc",
	"src",
	"Dockerfile",
	".dockerignore",
	"docker-compose.yml",
	"Caddyfile",
	"workerd.capnp",
	"README.md",
])
	copy(join("packages/relay", file), join("relay", file));
copy("README.md");
copy("LICENSE");

writeFileSync(
	join(STAGE, "package.json"),
	`${JSON.stringify(
		{
			name: "openfabriq",
			version: manifest("cli").version,
			description:
				"Run a software factory described in an openfabriq/ folder of your repository, on your machine, with your Claude Code.",
			type: "module",
			bin: { openfabriq: "dist/index.js" },
			engines: { node: ">=24" },
			license: "Apache-2.0",
			repository: `github:${REPOSITORY}`,
			homepage: process.env.OPENFABRIQ_SITE_URL ?? "https://openfabriq.dev",
			dependencies,
		},
		null,
		"\t",
	)}\n`,
);

execFileSync("npm", ["pack", "--pack-destination", OUT], {
	cwd: STAGE,
	stdio: "inherit",
});
