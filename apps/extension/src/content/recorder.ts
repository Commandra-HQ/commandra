/**
 * Manual recording — intercepts user DOM interactions and reports them.
 *
 * Injected into the page via chrome.scripting.executeScript when the user
 * starts manual recording. Captures clicks, text input, select changes,
 * and form submissions. Sends each action back to the background script.
 */

export function startRecorderInPage() {
	// Prevent double-injection
	if ((window as unknown as Record<string, unknown>).__afe_recorder_active) return;
	(window as unknown as Record<string, unknown>).__afe_recorder_active = true;

	const RECORDER_ID = '__afe-recorder';

	// Visual indicator
	const banner = document.createElement('div');
	banner.id = RECORDER_ID;
	banner.style.cssText =
		'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#ef4444;color:white;font:12px/24px system-ui;text-align:center;pointer-events:none;';
	banner.textContent = 'Recording actions...';
	document.body.appendChild(banner);

	function buildSelector(el: Element): string {
		// Priority: data-testid > id > aria-label > name > classes > nth-child
		const testId = el.getAttribute('data-testid');
		if (testId) return `[data-testid="${testId}"]`;

		if (el.id) return `#${el.id}`;

		const ariaLabel = el.getAttribute('aria-label');
		const tag = el.tagName.toLowerCase();
		if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;

		const name = el.getAttribute('name');
		if (name) return `${tag}[name="${name}"]`;

		// Try class-based
		if (el.className && typeof el.className === 'string') {
			const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
			if (classes) {
				const selector = `${tag}.${classes}`;
				// Verify uniqueness
				if (document.querySelectorAll(selector).length === 1) return selector;
			}
		}

		// Fall back to nth-child path
		const parts: string[] = [];
		let current: Element | null = el;
		while (current && current !== document.body) {
			const parent = current.parentElement;
			if (!parent) break;
			const siblings = Array.from(parent.children).filter(
				(c) => c.tagName === current!.tagName,
			);
			if (siblings.length === 1) {
				parts.unshift(current.tagName.toLowerCase());
			} else {
				const index = siblings.indexOf(current) + 1;
				parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
			}
			current = parent;
			if (parts.length >= 4) break; // Don't go too deep
		}
		return parts.join(' > ');
	}

	function getLabel(el: Element): string {
		return (
			el.getAttribute('aria-label') ||
			el.getAttribute('title') ||
			el.textContent?.trim().slice(0, 60) ||
			el.getAttribute('placeholder') ||
			el.getAttribute('name') ||
			''
		);
	}

	function sendAction(action: string, args: Record<string, unknown>) {
		window.postMessage(
			{
				type: '__AFE_RECORDED_ACTION',
				action,
				args,
				url: window.location.href,
			},
			'*',
		);
	}

	// --- Click handler ---
	function handleClick(e: MouseEvent) {
		const target = e.target as Element;
		if (!target || target.id === RECORDER_ID) return;

		// Only record clicks on interactive elements
		const interactive = target.closest(
			'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick]',
		);
		if (!interactive) return;

		// Don't record if the click is inside an input (that's handled by input/change)
		if (target.closest('input, select, textarea')) return;

		const selector = buildSelector(interactive);
		const label = getLabel(interactive);
		sendAction('click_element', { selector, label });
	}

	// --- Input handler (debounced) ---
	let inputTimer: ReturnType<typeof setTimeout> | null = null;
	let lastInput: { selector: string; value: string } | null = null;

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement | HTMLTextAreaElement;
		if (!target || !('value' in target)) return;

		const selector = buildSelector(target);
		const value = target.value;

		lastInput = { selector, value };

		// Debounce — wait for user to stop typing
		if (inputTimer) clearTimeout(inputTimer);
		inputTimer = setTimeout(() => {
			if (lastInput) {
				sendAction('type_text', {
					selector: lastInput.selector,
					text: lastInput.value,
					label: getLabel(target),
				});
				lastInput = null;
			}
		}, 800);
	}

	// --- Select handler ---
	function handleChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		if (!target || target.tagName.toLowerCase() !== 'select') return;

		const selector = buildSelector(target);
		const selectedOption = target.options[target.selectedIndex];
		sendAction('select_option', {
			selector,
			value: target.value,
			label: selectedOption?.text || target.value,
		});
	}

	// Add listeners (capture phase to get events before app handlers)
	document.addEventListener('click', handleClick, true);
	document.addEventListener('input', handleInput, true);
	document.addEventListener('change', handleChange, true);

	// Store cleanup function
	(window as unknown as Record<string, unknown>).__afe_recorder_cleanup = () => {
		document.removeEventListener('click', handleClick, true);
		document.removeEventListener('input', handleInput, true);
		document.removeEventListener('change', handleChange, true);
		banner.remove();
		if (inputTimer) clearTimeout(inputTimer);
		delete (window as unknown as Record<string, unknown>).__afe_recorder_active;
		delete (window as unknown as Record<string, unknown>).__afe_recorder_cleanup;
	};
}

export function stopRecorderInPage() {
	const cleanup = (window as unknown as Record<string, unknown>).__afe_recorder_cleanup;
	if (typeof cleanup === 'function') {
		(cleanup as () => void)();
	}
}
