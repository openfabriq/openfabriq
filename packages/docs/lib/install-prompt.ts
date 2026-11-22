import { GITHUB } from "./layout.shared";

/**
 * The prompt a visitor pastes into Claude Code, on their own computer, to install the engine on a
 * server over SSH. The secrets stay out of the conversation: the agent writes .env with them
 * empty, and the person fills them in. Coolify has its command, openfabriq deploy coolify.
 */
export const INSTALL_PROMPT = `Install the openfabriq engine on a server. openfabriq runs AI agents described in an openfabriq/ folder of GitHub repositories; the engine is one Docker container: ${GITHUB}

Go step by step. Never install system packages, use sudo, log in, accept an SSH host key or change my settings for me: when something is missing, tell me the command that fixes it and stop. Never ask me for a token or a password, never print them, and never read the .env file: I write the secrets in it myself.

1. Ask me, in one message: the server's SSH address (user@host), or "this machine" if you already run on the server; which GitHub repositories the engine runs (owner/name, comma-separated; each needs an openfabriq/ folder on its default branch); and whether the factory works on GitHub as my team's GitHub App (the default) or, if I cannot create one, with a token; only with a token, what name and email the factory's commits carry (a bot name makes it clear).

2. Every command below that runs on the server goes through \`ssh <address> '…'\`, or runs directly when this machine is the server. First check that \`ssh -o BatchMode=yes <address> true\` works. If it does not, tell me to connect once by hand (it asks me to accept the host key) and stop.

3. On the server, check that it runs Linux, and that Docker, Docker Compose and git are installed (\`docker --version\`, \`docker compose version\`, \`git --version\`) and that my user can run docker without sudo. If not, tell me what to do and stop.

4. Get the sources on the server, in ~/openfabriq unless I say otherwise:
   git clone ${GITHUB}.git <folder>

5. Write <folder>/.env on the server with my answers (OPENFABRIQ_REPOSITORIES, and with a token GIT_USER_NAME and GIT_USER_EMAIL) and these lines left empty, each with a comment on where to get the value:
   ANTHROPIC_API_KEY=    # a Claude Console API key (or CLAUDE_CODE_OAUTH_TOKEN, from \`claude setup-token\`, for a server only I use)
   With the app:
   GITHUB_APP_ID=           # printed by \`openfabriq connect github\` (add --org <organization> for an organization's repositories), which I run myself on my computer: it opens GitHub in my browser to create and install the app
   GITHUB_APP_PRIVATE_KEY=  # printed by the same command
   With a token instead:
   GH_TOKEN=             # a classic token of the factory's GitHub account, with the repo scope
   Then tell me to fill them in myself, in my own terminal: \`ssh -t <address> nano <folder>/.env\` (or the editor of my choice), and to say "done". Wait for me.

6. In <folder>, run \`docker compose up -d\`, then \`docker compose ps\` and \`docker compose logs --tail 100 engine\`. Report each line that starts with ✗ (it comes from \`openfabriq doctor\`, with its fix) and any "was not applied". Never run \`docker compose down -v\`: it deletes the engine's data.

7. Finish with what runs, what is left for me (the studio's password and domain, the relay for Slack and Linear: both are in the documentation's Docker page), and nothing else.`;
