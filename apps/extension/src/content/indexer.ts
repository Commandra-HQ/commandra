import type { IndexedElement, PageIndex, ElementType } from '@afe/shared';

const INTERACTIVE_SELECTORS = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[onclick]',
  'table',
  'form',
];

function getElementType(el: Element): ElementType {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'input';
  }
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'table') return 'table';
  if (tag === 'form') return 'form';
  return 'other';
}

function getLabel(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Check for associated label element
  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label?.textContent?.trim())
      return label.textContent.trim().slice(0, 100);
  }

  const title = el.getAttribute('title');
  if (title) return title;

  const text = el.textContent?.trim().slice(0, 100);
  if (text) return text;

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder;

  const name = el.getAttribute('name');
  if (name) return name;

  return el.tagName.toLowerCase();
}

function buildSelector(el: Element): string {
  // Priority: data-testid > id > aria-label > classes > nth-child
  const testId =
    el.getAttribute('data-testid') || el.getAttribute('data-test-id');
  if (testId) return `[data-testid="${testId}"]`;

  if (el.id) return `#${el.id}`;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[aria-label="${ariaLabel}"]`;
  }

  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute('name');
  if (name) return `${tag}[name="${name}"]`;

  const classes = Array.from(el.classList).slice(0, 3).join('.');
  if (classes) {
    const selector = `${tag}.${classes}`;
    if (document.querySelectorAll(selector).length === 1) return selector;
  }

  // Fallback: nth-child path
  return buildNthChildPath(el);
}

function buildNthChildPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body) {
    const parent = current.parentElement as Element | null;
    if (!parent) break;

    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(current) + 1;
    const tag = current.tagName.toLowerCase();
    parts.unshift(`${tag}:nth-child(${index})`);

    if (parts.length >= 3) break; // Keep paths short
    current = parent;
  }

  return parts.join(' > ');
}

function buildFallbackSelectors(el: Element): string[] {
  const fallbacks: string[] = [];
  const primary = buildSelector(el);

  if (el.id && primary !== `#${el.id}`) fallbacks.push(`#${el.id}`);

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).slice(0, 2).join('.');
  if (classes) {
    const classSelector = `${tag}.${classes}`;
    if (classSelector !== primary) fallbacks.push(classSelector);
  }

  const nthChild = buildNthChildPath(el);
  if (nthChild !== primary) fallbacks.push(nthChild);

  return fallbacks.slice(0, 3);
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const style = getComputedStyle(el);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  )
    return false;

  return true;
}

function detectPageType(): PageIndex['pageType'] {
  const url = window.location.pathname;
  const tables = document.querySelectorAll('table').length;
  const forms = document.querySelectorAll('form').length;

  if (
    url.includes('settings') ||
    url.includes('preferences') ||
    url.includes('config')
  )
    return 'settings';
  if (forms > 0 && tables === 0) return 'form';
  if (tables > 0) return 'table';
  if (url.match(/\/\d+$/) || url.match(/\/[a-f0-9-]{36}$/)) return 'detail';
  if (url === '/' || url.includes('dashboard') || url.includes('home'))
    return 'dashboard';
  return 'other';
}

export function indexPage(): PageIndex {
  const elements: IndexedElement[] = [];
  const seen = new Set<Element>();

  for (const selector of INTERACTIVE_SELECTORS) {
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);

      if (!isVisible(el)) continue;

      const rect = el.getBoundingClientRect();
      elements.push({
        id: crypto.randomUUID(),
        type: getElementType(el),
        label: getLabel(el),
        selector: buildSelector(el),
        fallbackSelectors: buildFallbackSelectors(el),
        attributes: {},
        position: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        visible: true,
        pageUrl: window.location.href,
      });
    }
  }

  const navigationLinks = Array.from(document.querySelectorAll('a[href]'))
    .filter(a => {
      const href = a.getAttribute('href') || '';
      return (
        (href.startsWith('/') || href.startsWith(window.location.origin)) &&
        !href.startsWith('javascript:') &&
        !href.match(/\.(pdf|png|jpg|jpeg|gif|svg|css|js|zip|csv)$/i)
      );
    })
    .map(a => ({
      label: a.textContent?.trim().slice(0, 80) || '',
      href: new URL(a.getAttribute('href') || '', window.location.origin)
        .pathname,
    }))
    .filter(
      (link, i, arr) =>
        link.href && arr.findIndex(l => l.href === link.href) === i,
    );

  return {
    url: window.location.href,
    urlPattern: window.location.pathname
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[a-f0-9-]{36}/g, '/:id'),
    title: document.title,
    pageType: detectPageType(),
    elements,
    navigationLinks,
    timestamp: Date.now(),
  };
}
