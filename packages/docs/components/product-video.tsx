"use client";

// The presentation film, made in packages/video. It loads only when someone presses play.
// ElevenLabs' free plan, which voiced it, asks for "elevenlabs.io" wherever it is published.
export function ProductVideo({ className = "" }: { className?: string }) {
	return (
		<figure className={`not-prose mx-auto w-full max-w-5xl ${className}`}>
			<video
				// Full volume is loud for a film that starts on a click.
				ref={(video) => {
					if (video) video.volume = 0.3;
				}}
				controls
				playsInline
				preload="none"
				poster="/video/openfabriq-poster.jpg"
				aria-label="openfabriq in 85 seconds"
				className="aspect-video w-full rounded-2xl border border-of-line bg-of-panel shadow-of-2"
			>
				<source src="/video/openfabriq.mp4" type="video/mp4" />
				<track
					kind="captions"
					src="/video/openfabriq.en.vtt"
					srcLang="en"
					label="English"
				/>
			</video>
			<figcaption className="mt-3 text-center text-sm text-fd-muted-foreground">
				openfabriq in 85 seconds. Voice by elevenlabs.io · Music: The Warm
				Minimal by Pumpupthemind (Pixabay)
			</figcaption>
		</figure>
	);
}
