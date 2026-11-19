// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Chat } from "../../../app/src/features/chat/Chat.js";

// The message box keeps one name for screen readers, whatever its placeholder says.

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("names the message box for screen readers", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
	);
	render(<Chat project="acme/composer" projects={["acme/composer"]} />);
	await act(async () => {});
	expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
});
