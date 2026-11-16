import { BoardDemo } from "../board-demo";
import { SectionHeading } from "./section-heading";

/** The studio's board, playing. */
export function Board() {
	return (
		<section
			aria-labelledby="board"
			className="border-t border-of-line bg-fd-background py-24 sm:py-32"
		>
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<SectionHeading
					id="board"
					lead={
						<>
							<code className="of-inline-code">openfabriq start</code> runs the
							engine and serves the studio, on your machine or a server. Issues,
							errors and failed deploys move across the board as agents pick
							them up, finish, or hand them to you.
						</>
					}
				>
					Then the factory works. You watch.
				</SectionHeading>
				<div className="mt-14">
					<BoardDemo />
				</div>
			</div>
		</section>
	);
}
