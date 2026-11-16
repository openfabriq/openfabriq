import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import {
	type ChatTurn,
	chatTurn,
	errorText,
	factoryMcpServer,
	githubApp,
	home,
	listProjects,
	studioTokenPath,
} from "@openfabriq/runner";
import type { StudioAccess } from "./access/env.js";
import { githubSignIn, writerOf } from "./access/github.js";
import { checkAccess, signedOutPage } from "./access/guard.js";
import { failedLogins, loginHandler, logoutHandler } from "./access/login.js";
import { signedIn } from "./access/session.js";
import { chatHandler } from "./chat/chat.js";
import { threadsDir } from "./chat/threads.js";
import { appChatTools } from "./chat/tools.js";
import { connectorRoutes } from "./connector/routes.js";
import { jsonAnswer, refuse, send, textAnswer } from "./http/answer.js";
import { staticFile } from "./http/static-files.js";
import { answerRead, findWrite, readRoutes, writeRoutes } from "./routes.js";
import { askSubject } from "./subjects/ask-subject.js";
import { cachedStates } from "./subjects/cached-states.js";
import type { AskSubject } from "./subjects/subject-state.js";
import { refreshWiki } from "./wiki/wiki.js";

/** A new token for the studio's address, in a file only this user reads: `start` prints it, the Vite dev server reads it. */
function writeStudioToken(): string {
	const token = randomBytes(32).toString("hex");
	const tokenFile = studioTokenPath();
	mkdirSync(home(), { recursive: true });
	writeFileSync(tokenFile, token, { mode: 0o600 });
	chmodSync(tokenFile, 0o600);
	return token;
}

/**
 * On 127.0.0.1 only. Serves the app built by Vite and the JSON it reads; the chat, its
 * conversations and the wiki's Refresh button are its only writes. Its page and every API route want the cookie
 * that the address printed by `start` sets: code in a sandbox reaches 127.0.0.1 too.
 * With a password, a sign-in form sets it too, and the studio answers on its https address.
 */
export function startStudio(
	port = 4310,
	appDir = join(import.meta.dirname, "app"),
	deps: {
		chat?: ChatTurn;
		/** Asks whether a subject is still open; GitHub, Linear and Sentry by default. */
		subjectState?: AskSubject;
		access?: StudioAccess;
		/** Tells the engine a manual run was asked, so it takes it now rather than at its next tick. */
		wake?: () => void;
	} = {},
): Server {
	const { password, url: studioUrl, github: client } = deps.access ?? {};
	const root = resolve(appDir);
	const token = writeStudioToken();
	const projects = () => listProjects().map((p) => p.repository);
	// `start` checked that the engine has its GitHub App.
	const app = client ? githubApp() : undefined;
	const github =
		client && studioUrl && app
			? githubSignIn({
					...client,
					url: studioUrl,
					writer: (login) => writerOf(app, projects(), login),
				})
			: undefined;
	const gate = {
		token,
		password,
		url: studioUrl,
		github: github !== undefined,
	};
	const subjectStates = cachedStates(deps.subjectState ?? askSubject());
	const reads = readRoutes(subjectStates);
	// The studio's sign-in and the connector's take the same password: one count of failures.
	const failures = failedLogins();
	// On the studio's https address only: Claude reaches it from Anthropic's cloud.
	const connector =
		(password || github) && studioUrl
			? connectorRoutes({
					password,
					github,
					url: studioUrl,
					failures,
					server: () =>
						factoryMcpServer((repository) =>
							appChatTools(repository, subjectStates),
						),
					grantsPath: join(home(), "mcp-grants.json"),
				})
			: {};
	const writes = writeRoutes({
		login: password
			? loginHandler({
					password,
					token,
					failures,
					github: github !== undefined,
					...(studioUrl ? { url: studioUrl } : {}),
				})
			: undefined,
		chat: chatHandler({
			chat:
				deps.chat ??
				((input) =>
					chatTurn(
						input,
						undefined,
						appChatTools(input.repository, subjectStates),
					)),
			projects,
			threadsDir,
			...(studioUrl ? { url: studioUrl } : {}),
		}),
		refreshWiki: (req, res) =>
			refreshWiki(req, res, {
				projects,
				...(deps.wake ? { wake: deps.wake } : {}),
				...(studioUrl ? { url: studioUrl } : {}),
			}),
	});

	const signOut =
		password || github
			? {
					"POST /logout": logoutHandler({
						...(studioUrl ? { url: studioUrl } : {}),
						...(github ? { cookies: [github.signOutCookie] } : {}),
					}),
				}
			: {};

	const handle = async (
		req: IncomingMessage,
		res: ServerResponse,
		fail: (error: unknown) => void,
	) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		// Only on the studio's address: the session's cookie is Secure.
		const login =
			github && req.headers.host === studioUrl?.host
				? await github.session(req, res)
				: undefined;
		const known = login !== undefined || signedIn(req, token);
		const refused = checkAccess(req, url, known, gate);
		if (refused) return send(res, refused);
		if (url.pathname === "/api/me" && req.method === "GET")
			return send(
				res,
				jsonAnswer(200, {
					...(login ? { login } : {}),
					signOut: Boolean(password || github),
				}),
			);
		const write =
			findWrite(writes, req.method, url.pathname) ??
			findWrite(signOut, req.method, url.pathname) ??
			findWrite(github?.routes ?? {}, req.method, url.pathname) ??
			findWrite(connector, req.method, url.pathname);
		if (write)
			return void write(req, res).catch((error: unknown) => {
				// Its answer may be half sent: the connection closes, and the reason is kept.
				process.stderr.write(
					`openfabriq: the studio could not answer ${req.method} ${url.pathname}: ${errorText(error)}\n`,
				);
				res.destroy();
			});
		if (req.method !== "GET")
			return send(res, textAnswer(405, "text/plain", "Read only."));
		if (url.pathname.startsWith("/api/"))
			return void answerRead(url, reads)
				.then((reply) => send(res, jsonAnswer(reply.status, reply.body)))
				.catch(fail);
		send(
			res,
			staticFile(
				root,
				url.pathname,
				known ? undefined : signedOutPage(password, github !== undefined),
			),
		);
	};

	// The engine runs in this process: a request must never throw out of the handler.
	const server = createServer((req, res) => {
		// No other site shows the studio in a frame, to make its buttons be clicked.
		res.setHeader("x-frame-options", "DENY");
		res.setHeader("content-security-policy", "frame-ancestors 'none'");
		// A private app: the sign-in page, which is not HTML, says it too.
		res.setHeader("x-robots-tag", "noindex, nofollow");
		const fail = (error: unknown) =>
			res.headersSent
				? void res.destroy()
				: refuse(res, error instanceof URIError ? 400 : 500, String(error));
		handle(req, res, fail).catch(fail);
	});
	// `start` refuses a taken port before it starts; a port lost later only turns the studio off.
	server.on("error", (error) =>
		process.stderr.write(
			`openfabriq: the studio cannot listen on 127.0.0.1:${port}: ${error.message}\n`,
		),
	);
	server.listen(port, "127.0.0.1");
	return server;
}
