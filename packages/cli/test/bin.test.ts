import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// The built CLI, run as a user runs it: this checks the bin and the paths dist/ resolves.
const ROOT = join(import.meta.dirname, "../../..");
const BIN = join(ROOT, "packages/cli/dist/index.js");
const built = existsSync(BIN);
const openfabriq = (...args: string[]) =>
	spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

it.skipIf(!built)(
	"validate exits 0 on an example (skipped until pnpm build makes packages/cli/dist)",
	() => {
		const result = openfabriq("validate", join(ROOT, "fixtures/valid/sdlc"));
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("is valid");
	},
);

it.skipIf(!built)(
	"validate exits 1 on an invalid factory (skipped until pnpm build makes packages/cli/dist)",
	() => {
		const result = openfabriq(
			"validate",
			join(ROOT, "fixtures/invalid/many-problems"),
		);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("errors in");
	},
);

it.skipIf(!built)(
	"--version and -v print the version and exit 0 (skipped until pnpm build makes packages/cli/dist)",
	() => {
		const { version } = JSON.parse(
			readFileSync(join(ROOT, "packages/cli/package.json"), "utf8"),
		) as { version: string };
		for (const flag of ["--version", "-v"]) {
			const result = openfabriq(flag);
			expect(result.status).toBe(0);
			expect(result.stdout.trim()).toBe(`openfabriq ${version}`);
		}
	},
	60_000,
);

it.skipIf(!built)(
	"--help and help print the usage and exit 0 (skipped until pnpm build makes packages/cli/dist)",
	() => {
		for (const args of [["--help"], ["-h"], ["help"], ["plan", "--help"]]) {
			const result = openfabriq(...args);
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Usage: openfabriq");
		}
	},
	// Four starts of the CLI: well past Vitest's 5 s on a loaded machine.
	60_000,
);
