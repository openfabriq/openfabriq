import { PlanTerminal } from "../plan-terminal";
import { SectionHeading } from "./section-heading";

/** openfabriq plan, printed as it is in a terminal. */
export function Plan() {
	return (
		<section aria-labelledby="plan" className="pb-24 sm:pb-32">
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<SectionHeading
					id="plan"
					lead={
						<>
							<code className="of-inline-code">openfabriq plan</code> compares
							the folder with what runs on this machine and lists every change,
							with new rights and tools at the top. Nothing changes until you
							run <code className="of-inline-code">openfabriq apply</code>
						</>
					}
				>
					Review the plan, security first. Then apply.
				</SectionHeading>
				<div className="mt-14">
					<PlanTerminal />
				</div>
			</div>
		</section>
	);
}
