# 01: Quickstart, from an issue to a pull request

The smallest useful factory: one repository, one agent, one deliverable. A maintainer adds the `ready-for-agent` label to an issue; the implementation agent opens a pull request; a human reviews and merges. To change the pull request, the maintainer asks in a comment that mentions `@openfabriq`: "@openfabriq add a test for an empty title". That part is native: the engine sends the implementer back to its own pull request when a maintainer mentions `@openfabriq`, without an automation to write. Two automations send it back too, written down: when a review requests changes, and when the pull request conflicts with its base.

## What this factory does

<img src="workflow.png" width="1190" alt="An issue labeled ready-for-agent goes to the implementer, which opens a pull request. Requested changes, a conflict, or a maintainer's comment that mentions @openfabriq send the implementer back to its pull request.">

## Tree

```
openfabriq/
├── factory.yaml
├── agents/
│   └── implementer/agent.md                    turns an issue into a pull request
└── automations/
    ├── implement-ready-issues/automation.md    when: issue.labeled ready-for-agent
    ├── rework-pull-requests/automation.md      when: pull_request.changes_requested
    └── resolve-conflicts/automation.md         when: pull_request.conflicted
```

The name of a folder is the name of the resource: `agents/implementer/` defines the agent `implementer`.

## Make it yours

1. Copy the `openfabriq/` folder to the root of your repository.
2. In `factory.yaml`, replace `repository` and `maintainers`, and set `setup` and the `test` command to your project's own: the engine runs the tests itself before any pull request leaves your machine (`checks`).
3. Run `openfabriq validate`, then `openfabriq plan`: it shows the `ready-for-agent` label it will create, and the implementer's answer to mentions. Add `answer_mentions: false` to `factory.yaml` if comments should never start an agent.
4. Run `openfabriq apply`, then `openfabriq start`.
5. Add the `ready-for-agent` label to an issue.
