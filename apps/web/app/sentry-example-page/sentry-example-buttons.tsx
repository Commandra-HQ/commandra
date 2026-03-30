'use client';

import { Button } from '@/components/ui/button';

export function SentryExampleButtons() {
	return (
		<div className="flex flex-col gap-3">
			<Button
				type="button"
				onClick={() => {
					throw new Error('Sentry Example Frontend Error');
				}}
			>
				Throw test error
			</Button>
			<Button
				type="button"
				variant="outline"
				onClick={() => {
					// Same pattern as Sentry docs — ReferenceError at runtime
					return new Function('return myUndefinedFunction()')();
				}}
			>
				Call undefined function
			</Button>
		</div>
	);
}
