import { WindowFrame } from "../window-frame";
import { SectionHeading } from "./section-heading";

/**
 * The studio itself, to click through: its demo build, with a made-up factory's recorded data
 * (packages/studio/scripts/docs-demo.ts), served from public/studio-demo/.
 */
export function Studio() {
	return (
		// data-nosnippet: Google used this section as the home's search snippet instead of its description.
		<section aria-labelledby="studio" data-nosnippet className="py-24 sm:py-32">
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<SectionHeading
					id="studio"
					lead="A local app, served by the engine, that only reads. Follow the factory without opening a terminal."
				>
					Everything the factory does, in one place.
				</SectionHeading>
				<div className="mt-14">
					<WindowFrame title="127.0.0.1:4310" example>
						<iframe
							src="/studio-demo/index.html#/overview?project=acme%2Fweb-app"
							title="The openfabriq studio, with an example factory: click through its pages"
							loading="lazy"
							className="block h-[40rem] w-full bg-of-ground md:h-auto md:aspect-[16/10]"
						/>
					</WindowFrame>
					<p className="mt-3 text-center text-sm text-fd-muted-foreground">
						The real studio, with example data. Click around, and ask the chat.
					</p>
				</div>
			</div>
		</section>
	);
}
