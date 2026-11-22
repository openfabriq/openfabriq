"use client";

import { Play, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { ProductVideo } from "../product-video";

/**
 * The film, as the third action of the hero: a dark disc that calls, slowly, and two lines.
 * It opens in a modal, playing; Escape, the cross or a click beside it closes it and pauses it.
 */
export function VideoButton({ className }: { className?: string }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const video = () => dialog.current?.querySelector("video");
	const open = () => {
		dialog.current?.showModal();
		const film = video();
		if (!film) return;
		// The film starts at 30% volume; a visitor's own setting stays for the next opening.
		if (!film.played.length) film.volume = 0.3;
		void film.play();
	};
	return (
		<>
			<button
				type="button"
				onClick={open}
				className={cn(
					// A soft pill rises behind the disc and its words on hover; the padding is pulled back so the disc lines up.
					"group -ml-1 inline-flex shrink-0 items-center gap-3 self-start rounded-full py-1 pr-4 pl-1 text-left transition-colors duration-300 ease-of hover:bg-of-sunken focus-visible:rounded-full! sm:-my-1 sm:ml-1 sm:self-auto dark:hover:bg-of-panel",
					className,
				)}
			>
				<span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-fd-foreground text-fd-background shadow-of-2">
					<span
						className="of-beckon absolute inset-0 rounded-full"
						aria-hidden
					/>
					<Play className="size-4 translate-x-px fill-current" aria-hidden />
				</span>
				<span className="flex flex-col leading-tight">
					<span className="text-[15px] font-semibold whitespace-nowrap text-fd-foreground">
						Watch the film
					</span>
					<span className="tnum text-[13px] whitespace-nowrap text-fd-muted-foreground">
						85 seconds
					</span>
				</span>
			</button>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a mouse shortcut; Escape and the close button serve the keyboard */}
			<dialog
				ref={dialog}
				aria-label="openfabriq in 85 seconds"
				onClose={() => video()?.pause()}
				// A click on the backdrop lands on the dialog itself, not on the film.
				onClick={(e) => {
					if (e.target === dialog.current) dialog.current.close();
				}}
				className="m-auto w-[calc(100%-2rem)] max-w-5xl bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-sm"
			>
				<form method="dialog" className="mb-2 flex justify-end">
					<button
						type="submit"
						aria-label="Close the film"
						className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
					>
						<X className="size-5" aria-hidden />
					</button>
				</form>
				<ProductVideo />
			</dialog>
		</>
	);
}
