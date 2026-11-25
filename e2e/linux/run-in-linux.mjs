// Runs inside the Linux container (Dockerfile): one agent through the engine's own launcher
// (claudeAgent, with its sandbox), and prints `RESULT <json>` on its last line.
//   node run-in-linux.mjs shell   an agent with shell runs probe.sh in the sandbox
//   node run-in-linux.mjs read    an agent without shell answers, no Bash
//   node run-in-linux.mjs commands  the engine runs probe.sh as a check would, no agent
//   node run-in-linux.mjs token   the engine's Claude login comes from CLAUDE_CODE_OAUTH_TOKEN, as in
//                                 Docker; a fake API (no account) has the agent's shell look for it
//   node run-in-linux.mjs api-key the same with ANTHROPIC_API_KEY next to the token: the key wins
//   node run-in-linux.mjs refs    with the fake API, the agent's shell commits, then tries to move
//                                 origin's branch in the clone every run shares
//   node run-in-linux.mjs network with the fake API, the agent.s shell tries a site off its network and one on it
//   node run-in-linux.mjs evidence the engine runs an automation; with the fake API, its agent serves a page,
//                                 screenshots it with agent-browser as the skill browser-evidence says,
//                                 commits the image and opens a pull request that shows it
//   node run-in-linux.mjs sockets with the fake API, the agent's shell tries the machine's Unix sockets
//   node run-in-linux.mjs settings with the fake API, the agent's shell runs probe.sh: where tools keep their settings
//   node run-in-linux.mjs astro   the engine builds a fresh Astro site as a check would, no agent
//   node run-in-linux.mjs command-sockets the engine runs a command that tries the machine's Unix
//                                 sockets, then screenshots a page with the skill's script, as a parity check does
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	claudeAgent,
	credentialFreeEnv,
	projectDir,
	readRuns,
	requestRun,
	startEngine,
	workspace,
	writeApplied,
} from "/repo/packages/runner/dist/index.js";

const scenario = process.argv[2];
const home = process.env.HOME;
const canary = (name) => `${name}-${Math.random().toString(36).slice(2)}`;
const TOKEN = canary("canary-token");
const write = (path, text) => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
};

// The engine's home in the user's home folder, as ~/.openfabriq is, and the machine's secrets.
process.env.OPENFABRIQ_HOME = mkdtempSync(join(home, "openfabriq-"));
const engineHome = process.env.OPENFABRIQ_HOME;
const secrets = {
	"secrets.json": join(engineHome, "secrets.json"),
	"viewer-token": join(engineHome, "viewer-token"),
	"ssh key": join(home, ".ssh/id_e2e"),
	"gh config": join(home, ".config/gh/hosts.yml"),
	"claude login": join(home, ".claude/.credentials.json"),
	"another run": join(
		engineHome,
		"projects/acme/app/runs/other/transcript.jsonl",
	),
};
for (const [name, path] of Object.entries(secrets))
	if (name !== "claude login")
		write(
			path,
			// The engine reads secrets.json (a GitHub App it may hold): valid JSON, the canary inside.
			name === "secrets.json"
				? JSON.stringify({ canary: canary(name) })
				: canary(name),
		);

// A toolchain installed in the home folder, as nvm or pnpm are: commands must still read it.
write(join(home, ".toolchain-e2e/bin/tool"), "toolchain\n");
const outside = join(home, `outside-${Math.random().toString(36).slice(2)}`);

// The engine's clone and a linked worktree, as the workspace adapter makes them.
const clone = join(engineHome, "projects/acme/app/repo");
const worktree = join(engineHome, "projects/acme/app/worktrees/run-1");
mkdirSync(clone, { recursive: true });
const git = (cwd, ...args) =>
	execFileSync(
		"git",
		["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args],
		{
			cwd,
			stdio: "pipe",
		},
	);
git(clone, "init", "--quiet", "--initial-branch=main");
git(clone, "commit", "--quiet", "--allow-empty", "-m", "first commit");
git(clone, "worktree", "add", "--quiet", "--detach", worktree, "main");
// Where origin's branches are in a clone the engine fetched into.
git(clone, "update-ref", "refs/remotes/origin/main", "HEAD");
writeFileSync(
	join(clone, ".git/packed-refs"),
	"# pack-refs with: peeled fully-peeled sorted\n",
);

const split = (s) => `A="${s.slice(0, 12)}"; B="${s.slice(12)}"`;
write(
	join(worktree, "probe.sh"),
	`# Says only whether each access worked; it never prints a secret.
${Object.entries(secrets)
	.map(
		([name, path]) =>
			`cat "${path}" >/dev/null 2>&1 && echo "read ${name}: YES" || echo "read ${name}: no"`,
	)
	.join("\n")}
cat "${home}/.toolchain-e2e/bin/tool" >/dev/null 2>&1 && echo "read toolchain: yes" || echo "read toolchain: NO"
touch "${outside}" 2>/dev/null; echo "tried to write outside"
echo note > note.txt && echo "write worktree: ok" || echo "write worktree: refused"
mkdir -p "$HOME/.config/e2e-probe" 2>/dev/null && echo "write ~/.config: YES" || echo "write ~/.config: no"
# A tool that expects its settings folder to exist: one mkdir, not -p.
mkdir "\${XDG_CONFIG_HOME:-$HOME/.config}/e2e-probe-$$" 2>/dev/null && echo "write settings: ok" || echo "write settings: refused"
for v in XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME; do eval "echo \\"$v: \\\${$v:-unset}\\""; done
${split(TOKEN)}
ps -axww -o args 2>/dev/null | grep -v grep | grep -q "\${A}\${B}" && echo "token in ps: YES" || echo "token in ps: no"
echo "processes seen: $(ps -axww -o pid= 2>/dev/null | wc -l | tr -d ' ')"
node -e "require('net').createServer().listen((process.env.TMPDIR||'/tmp')+'/e2e.sock',function(){console.log('unix socket: ok');process.exit(0)}).on('error',function(e){console.log('unix socket: refused ('+e.code+')');process.exit(0)})"
curl -s -o /dev/null https://registry.npmjs.org/ && echo "curl: ok" || echo "curl: failed"
echo "off the list: $(curl -s -o /dev/null -w "%{http_connect}" --max-time 10 https://off-the-list.invalid/)"
node -e "fetch('https://registry.npmjs.org/').then(function(){console.log('fetch: ok')},function(){console.log('fetch: failed')})"
git add note.txt && git -c user.name=e2e -c user.email=e2e@example.com commit --quiet -m probe && echo "git commit: ok" || echo "git commit: refused"
`,
);
git(worktree, "add", "probe.sh");
git(worktree, "commit", "--quiet", "-m", "add the probe");

if (scenario === "commands") {
	const { ok, output } = await workspace.run(
		clone,
		worktree,
		"sh probe.sh",
		credentialFreeEnv({ name: "e2e", email: "e2e@example.com" }),
		120_000,
		["packages"],
	);
	console.log(
		`RESULT ${JSON.stringify({ loggedIn: false, status: ok ? "succeeded" : "failed", reason: ok ? "" : output, costUsd: 0, bash: [output], outsideWritten: existsSync(outside), committed: "" })}`,
	);
	process.exit(0);
}

// The skill browser-evidence's script, as a factory ships it beside the skill.
const BROWSE = "openfabriq/skills/browser-evidence/scripts/browse.sh";

const fakeModel = (steps, port, log) =>
	spawn(
		process.execPath,
		["/repo/e2e/support/fake-anthropic.mjs", String(port), log],
		{
			env: { ...process.env, FAKE_STEPS: JSON.stringify(steps) },
			stdio: "ignore",
		},
	);

if (scenario === "evidence") {
	// Not acme/app: the probes above already made its clone.
	const REPO = "acme/site";
	const IMAGE = "evidence/1/home-built-390.png";
	writeApplied(REPO, {
		"factory.yaml": `name: E2E\nrepository: ${REPO}\nmaintainers: [alice]\nmodel: haiku\n`,
		"agents/builder/agent.md":
			"---\ndescription: Builds pages\ntools: [read, edit, shell]\n---\nYou build the page and prove it in a browser.\n",
		"automations/build/automation.md":
			'---\nwhen:\n  schedule: { cron: "0 3 * * *" }\nagent: builder\ncan: [create_pull_request]\n---\nBuild the home page.\n',
	});
	// The origin is a local bare repository; the engine's clone comes from it, as apply leaves it.
	const origin = mkdtempSync(join(home, "origin-"));
	git(origin, "init", "--quiet", "--bare", "--initial-branch=main");
	const seed = mkdtempSync(join(home, "seed-"));
	git(seed, "init", "--quiet", "--initial-branch=main");
	write(
		join(seed, "index.html"),
		"<title>Home</title><h1>Welcome</h1><p>Built by the factory.</p>",
	);
	write(
		join(seed, "serve.js"),
		"require('http').createServer((q, r) => r.end(require('fs').readFileSync('index.html'))).listen(4321, '127.0.0.1');",
	);
	write(
		join(seed, BROWSE),
		readFileSync(`/repo/examples/26-webflow-to-astro/${BROWSE}`, "utf8"),
	);
	git(seed, "add", ".");
	git(seed, "commit", "--quiet", "-m", "first commit");
	git(seed, "push", "--quiet", origin, "main");
	execFileSync("git", ["clone", "--quiet", origin, "repo"], {
		cwd: projectDir(REPO),
	});
	// The agent checks the page with the skill's script, in one command as on Linux it must, then
	// commits the image and prints the commit; the pull request links the image by it.
	const port = 40000 + Math.floor(Math.random() * 20000);
	const api = fakeModel(
		[
			{
				name: "Bash",
				input: {
					description: "screenshot the page",
					command: `sh ${BROWSE} "node serve.js" http://127.0.0.1:4321/ "open http://127.0.0.1:4321/" "set viewport 390 844" "screenshot --full ${IMAGE}"
git add evidence && git commit --quiet -m "Prove the home page" && git rev-parse HEAD`,
				},
			},
			{
				name: "mcp__openfabriq__create_pull_request",
				input: {
					title: "Build the home page",
					body: `| / | Built |\n| --- | --- |\n| 390 | ![built](https://github.com/${REPO}/blob/$LAST/${IMAGE}?raw=true) |`,
				},
			},
		],
		port,
		join(engineHome, "api.jsonl"),
	);
	process.env.CLAUDE_CODE_OAUTH_TOKEN = "fake";
	await new Promise((r) => setTimeout(r, 500));
	// GitHub, where every write is only recorded.
	const pulls = [];
	const no = async () => {
		throw new Error("not faked");
	};
	const github = new Proxy(
		{
			currentUser: async () => "e2e-bot",
			defaultBranch: async () => "main",
			labels: async () => [],
			issuesUpdatedSince: async () => [],
			openPulls: async () => [],
			reviews: async () => [],
			recentMerges: async () => [],
			branchHead: async () => "head",
			createPullRequest: async (_repo, pull) => {
				pulls.push(pull);
				return "https://github.com/acme/site/pull/7";
			},
		},
		{ get: (target, key) => target[key] ?? no },
	);
	requestRun(REPO, {
		id: "req-evidence",
		automation: "build",
		isPullRequest: false,
		by: "e2e",
		at: new Date().toISOString(),
	});
	const logs = [];
	const engine = startEngine({
		github,
		// The engine leaves ANTHROPIC_BASE_URL out of a run's environment: the fake API goes in here.
		launch: (run) =>
			claudeAgent({
				...run,
				env: { ...run.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` },
			}),
		workspace,
		identity: { name: "e2e", email: "e2e@example.com" },
		log: (line) => logs.push(line),
		intervalMs: 3_600_000,
	});
	engine.start();
	const until = Date.now() + 240_000;
	let run;
	while (!run && Date.now() < until) {
		await new Promise((r) => setTimeout(r, 500));
		run = readRuns(REPO).find((r) => r.endedAt);
	}
	engine.stop();
	api.kill();
	const sha = pulls[0]?.body.match(/blob\/([0-9a-f]{40})\//)?.[1];
	let png = "";
	try {
		png = execFileSync("git", ["cat-file", "blob", `${sha}:${IMAGE}`], {
			cwd: origin,
		})
			.subarray(0, 8)
			.toString("hex");
	} catch {}
	console.log(
		`RESULT ${JSON.stringify({ status: run?.status ?? "none", reason: run?.reason ?? logs.join("\n"), pulls, png, onOrigin: execFileSync("git", ["branch", "--format=%(refname:short)", "--contains", sha ?? "main"], { cwd: origin, encoding: "utf8" }).trim() })}`,
	);
	process.exit(0);
}

if (scenario === "sockets" || scenario === "command-sockets") {
	// What other programs of the machine listen on: an SSH agent, git's credential cache, gpg-agent.
	const foreign = [
		join("/tmp", `ssh-${canary("e2e")}`, "agent.1"),
		join(home, ".cache/git/credential/socket"),
		join(home, ".gnupg/S.gpg-agent"),
		join(home, "plain.sock"),
	];
	const { createServer } = await import("node:net");
	for (const path of foreign) {
		mkdirSync(join(path, ".."), { recursive: true });
		// The home folder is a volume: a socket of an earlier run is still there.
		rmSync(path, { force: true });
		createServer((c) => c.end("reached")).listen(path);
	}
	const port = 40000 + Math.floor(Math.random() * 20000);
	const probe = `const net = require("net");
for (const p of ${JSON.stringify(foreign)}) {
	const s = net.connect(p);
	s.on("data", () => { console.log(p + ": REACHED"); s.destroy(); });
	s.on("error", (e) => console.log(p + ": no (" + e.code + ")"));
}
const own = process.env.TMPDIR + "/own.sock";
net.createServer((c) => c.end("ok")).listen(own, () => net.connect(own).on("data", (d) => { console.log("own socket: " + d); process.exit(0); }));`;
	write(join(worktree, "sockets.js"), probe);
	if (scenario === "command-sockets") {
		write(join(worktree, "index.html"), "<title>Home</title><h1>Welcome</h1>");
		write(
			join(worktree, "serve.js"),
			"require('http').createServer((q, r) => r.end(require('fs').readFileSync('index.html'))).listen(4321, '127.0.0.1');",
		);
		write(
			join(worktree, "browse.sh"),
			readFileSync(`/repo/examples/26-webflow-to-astro/${BROWSE}`, "utf8"),
		);
		const { ok, output } = await workspace.run(
			clone,
			worktree,
			`node sockets.js; ls "$(dirname "$TMPDIR")" >/dev/null 2>&1 && echo "list the commands' folders: YES" || echo "list the commands' folders: no"; sh browse.sh "node serve.js" http://127.0.0.1:4321/ "open http://127.0.0.1:4321/" "screenshot shot.png"`,
			credentialFreeEnv({ name: "e2e", email: "e2e@example.com" }),
			180_000,
			["packages"],
		);
		let png = "";
		try {
			png = readFileSync(join(worktree, "shot.png"))
				.subarray(0, 8)
				.toString("hex");
		} catch {}
		console.log(
			`RESULT ${JSON.stringify({ status: ok ? "succeeded" : "failed", reason: ok ? "" : output, bash: [output], png })}`,
		);
		process.exit(0);
	}
	const api = fakeModel(
		[
			{
				name: "Bash",
				input: {
					description: "probe",
					command: `node sockets.js; ls "$(dirname "$(dirname "$TMPDIR")")" >/dev/null 2>&1 && echo "list the runs' folders: YES" || echo "list the runs' folders: no"; unshare -r true 2>/dev/null && echo "user namespace: YES" || echo "user namespace: no"`,
				},
			},
		],
		port,
		join(engineHome, "api.jsonl"),
	);
	process.env.CLAUDE_CODE_OAUTH_TOKEN = "fake";
	await new Promise((r) => setTimeout(r, 500));
	const transcript = join(engineHome, "transcript.jsonl");
	const result = await claudeAgent({
		prompt: "Probe.",
		instructions: "",
		cwd: worktree,
		model: "haiku",
		tools: ["read", "shell"],
		network: ["packages"],
		outputs: {
			tools: [],
			propose: () => {},
		},
		budgetUsd: 0.5,
		timeoutMs: 180_000,
		env: {
			...credentialFreeEnv({ name: "e2e", email: "e2e@example.com" }),
			ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
		},
		transcript,
	});
	api.kill();
	const bash = readFileSync(transcript, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l))
		.filter((m) => m.type === "user")
		.flatMap((m) => m.message?.content ?? [])
		.filter((b) => b.type === "tool_result")
		.map((b) =>
			typeof b.content === "string" ? b.content : JSON.stringify(b.content),
		);
	console.log(
		`RESULT ${JSON.stringify({ status: result.status, reason: result.reason ?? "", bash })}`,
	);
	process.exit(0);
}

if (scenario === "astro") {
	// A fresh site, installed beforehand. Astro's telemetry keeps a setting in the settings folder:
	// the one a previous run left in the home folder is removed, as on a fresh machine.
	const site = join(engineHome, "projects/acme/app/worktrees/site");
	execFileSync(
		"sh",
		[
			"-c",
			`rm -rf "$HOME/.config/astro" && npm create astro@latest "${site}" -- --template minimal --no-install --no-git --yes --skip-houston && cd "${site}" && npm install --no-audit --no-fund`,
		],
		{ stdio: "ignore" },
	);
	const { ok, output } = await workspace.run(
		clone,
		site,
		"npx astro build",
		credentialFreeEnv({ name: "e2e", email: "e2e@example.com" }),
		300_000,
		"any",
	);
	console.log(
		`RESULT ${JSON.stringify({ loggedIn: false, status: ok ? "succeeded" : "failed", reason: ok ? "" : output, costUsd: 0, bash: [output], outsideWritten: existsSync(join(home, ".config/astro")), committed: "" })}`,
	);
	process.exit(0);
}

// A remote MCP server whose bearer token is the canary: it sits in the arguments of claude.
const port = 40000 + Math.floor(Math.random() * 20000);
const server = spawn(
	process.execPath,
	["/repo/e2e/support/mcp-server.mjs", "http", String(port)],
	{
		env: { ...process.env, MCP_EXPECTED_TOKEN: TOKEN },
		stdio: "ignore",
	},
);

// The engine's login as Docker gives it, and a fake API in place of Anthropic's.
const OAUTH = canary("canary-oauth");
const KEY = canary("canary-api-key");
const apiLog = join(engineHome, "api.jsonl");
const REFS_PROBE = `echo x > refs.txt && git add refs.txt && git -c user.name=e2e -c user.email=e2e@example.com commit --quiet -m refs && echo "commit: ok" || echo "commit: refused"; git update-ref refs/remotes/origin/main HEAD 2>/dev/null && echo "move origin ref: YES" || echo "move origin ref: no"; git checkout --quiet -b side 2>/dev/null && echo "local branch: ok" || echo "local branch: refused"; echo >> "$(git rev-parse --git-common-dir)/config" 2>/dev/null && echo "change config: YES" || echo "change config: no"`;
// 403: the proxy refuses the site; 502: it lets the site through, and .invalid does not exist.
const NETWORK_PROBE = `echo "off the list: $(curl -s -o /dev/null -w "%{http_connect}" --max-time 10 https://off-the-list.invalid/)"; echo "listed: $(curl -s -o /dev/null -w "%{http_connect}" --max-time 10 https://allowed.invalid/)"`;
const fakeApi =
	(scenario === "token" ||
		scenario === "api-key" ||
		scenario === "refs" ||
		scenario === "network" ||
		scenario === "settings") &&
	spawn(
		process.execPath,
		["/repo/e2e/support/fake-anthropic.mjs", String(port + 1), apiLog],
		{
			env: {
				...process.env,
				FAKE_BASH:
					scenario === "settings"
						? "sh probe.sh"
						: scenario === "refs"
							? REFS_PROBE
							: scenario === "network"
								? NETWORK_PROBE
								: `printenv GH_TOKEN >/dev/null && echo "gh token in env: YES" || echo "gh token in env: no"; printenv CLAUDE_CODE_OAUTH_TOKEN >/dev/null && echo "token in env: YES" || echo "token in env: no"; ${split(OAUTH)}; cat /proc/[0-9]*/environ 2>/dev/null | tr '\\0' '\\n' | grep -q "\${A}\${B}" && echo "token in /proc: YES" || echo "token in /proc: no"; cat /proc/[0-9]*/environ 2>/dev/null | tr '\\0' '\\n' | grep -c "^PATH=" | sed "s/^/environments read: /"; printenv ANTHROPIC_API_KEY >/dev/null && echo "key in env: YES" || echo "key in env: no"; C="${KEY.slice(0, 12)}"; D="${KEY.slice(12)}"; cat /proc/[0-9]*/environ 2>/dev/null | tr '\\0' '\\n' | grep -q "\${C}\${D}" && echo "key in /proc: YES" || echo "key in /proc: no"; cat ${engineHome}/secrets/anthropic_api_key >/dev/null 2>&1 && echo "key file: READ" || echo "key file: no"`,
			},
			stdio: "ignore",
		},
	);
if (fakeApi) {
	process.env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH;
	if (scenario === "api-key") process.env.ANTHROPIC_API_KEY = KEY;
	process.env.GH_TOKEN = canary("canary-gh");
}
await new Promise((r) => setTimeout(r, 500));

const loggedIn = existsSync(secrets["claude login"]);
const transcript = join(engineHome, "transcript.jsonl");
const result = await claudeAgent({
	prompt:
		scenario === "shell"
			? "Run exactly this command and nothing else: sh probe.sh. Then report its output verbatim."
			: "Reply with the single word ready.",
	instructions: "",
	cwd: worktree,
	model: "haiku",
	tools: scenario === "read" ? ["read"] : ["read", "shell"],
	network: scenario === "network" ? ["allowed.invalid"] : ["packages"],
	outputs: {
		tools: [],
		propose: () => {},
	},
	mcp: {
		servers: {
			remote: {
				type: "http",
				url: `http://127.0.0.1:${port}/mcp`,
				headers: { Authorization: `Bearer ${TOKEN}` },
			},
		},
		tools: { remote: ["echo"] },
	},
	budgetUsd: 0.5,
	timeoutMs: 180_000,
	env: {
		...credentialFreeEnv({ name: "e2e", email: "e2e@example.com" }),
		...(fakeApi ? { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port + 1}` } : {}),
	},
	transcript,
});
server.kill();
if (fakeApi) fakeApi.kill();
// Which credential each request to the fake API carried; never the value itself.
const api = existsSync(apiLog)
	? readFileSync(apiLog, "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l))
			.map(({ authorization: a, apiKey: k }) =>
				a === `Bearer ${OAUTH}` && !k
					? "token"
					: k === KEY && (!a || a === `Bearer ${KEY}`)
						? "key"
						: a || k
							? "other"
							: "none",
			)
	: [];

const lines = existsSync(transcript)
	? readFileSync(transcript, "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l))
	: [];
const bash = lines
	.filter((m) => m.type === "user")
	.flatMap((m) => m.message?.content ?? [])
	.filter((b) => b.type === "tool_result")
	.map((b) =>
		typeof b.content === "string" ? b.content : JSON.stringify(b.content),
	);
// What the sandbox let out for real: a write outside the worktree, and the agent's commit.
const outsideWritten = existsSync(outside);
const committed = execFileSync("git", ["log", "--format=%s", "-1"], {
	cwd: worktree,
	encoding: "utf8",
}).trim();
console.log(
	`RESULT ${JSON.stringify({ loggedIn, status: result.status, reason: result.reason ?? "", costUsd: result.costUsd, bash, outsideWritten, committed, api })}`,
);
