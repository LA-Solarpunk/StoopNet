# Agent Conventions for Pochade-JS Projects

This file governs all code in this directory and its subdirectories.

## Technology Stack

- **JavaScript**: Vanilla ES2020+ (no frameworks)
- **CSS**: Standard CSS with variables (no CSS-in-JS, no Shadow DOM)
- **Build Tool**: Webpack 5 with SWC transpilation
- **Custom Elements**: dataroom-js (extends HTMLElement)
- **Workers**: Web Workers with custom inline bundling
<!-- <TESTING-ANY> -->
- **Testing**: see the Testing section below
<!-- </TESTING-ANY> -->

## Code Style

### Comments

Use **DocBlock style comments** for all classes, methods, and exported functions:

```javascript
/**
 * Brief description.
 *
 * @param {string} paramName Description
 * @returns {number} Description
 */
```

Use inline `//` comments for implementation logic.

### Custom Elements

**This is the core architecture of every Pochade-JS project: we build with custom HTML elements, and those elements talk to each other by setting attributes on one another.**

- An element's attributes ARE its public API. Another component should never reach into a component's internals or call its methods — it sets an attribute on the element instead: `document.querySelector('my-component').setAttribute('value', '42')`
- React to attribute changes by declaring `static get observedAttributes()` and implementing `attributeChangedCallback(name, oldValue, newValue)` (or reading attributes in `initialize()`)
- Keep state visible in markup: when internal state changes, reflect it back to an attribute so other elements (and users) can observe it
- Custom events (`this.event(...)`) may announce that something happened, but data flows between elements through attributes

```javascript
import DataroomElement from 'dataroom-js';

class MyComponent extends DataroomElement {
  async initialize() {
    // Component setup
  }
}

if (!customElements.get('my-component')) {
  customElements.define('my-component', MyComponent);
}
```

Rules:
- Element names MUST contain a hyphen
- NEVER use Shadow DOM
- NEVER embed CSS in JavaScript
- Create CSS in `styles/<component-name>.css` and import in `index.css`
- Always include ARIA attributes on rendered elements (see Accessibility section)

### Accessibility (ARIA)

**Directive:** Every custom element you create MUST be accessible. Add ARIA attributes and validate your HTML.

- Give every interactive custom element an appropriate `role` attribute
- Label every element with `aria-label` or `aria-labelledby` (never rely on visual position alone)
- Reflect component state in ARIA state attributes (`aria-expanded`, `aria-checked`, `aria-disabled`, `aria-live`, ...)
- Keep ARIA attributes up to date whenever the component's state changes
- Use semantic HTML elements first (`button`, `nav`, `main`, ...); reach for ARIA only when semantics are not enough
- Run the HTML validator before considering any change complete:

```bash
npm run validate:html
```

The validator must pass with zero errors. Fix invalid markup, duplicate attributes, and missing ARIA labels it reports.

### Web Workers

Always use this exact syntax:

```javascript
const worker = new Worker(new URL('./my-worker.js', import.meta.url));
```

Never use string paths: `new Worker('./my-worker.js')` — bundlers cannot trace them.

<!-- <TESTING-ANY> -->
### Testing

**Directive:** Write and run tests for every feature you add or change. Use each suite below for its stated purpose, keep all of them green, and add a matching test whenever you introduce new behavior.

<!-- <TESTING-E2E> -->
#### E2E Tests (Playwright)

- Use `@playwright/test` for all E2E tests
- Place tests in `tests/e2e/*.spec.js`
- Run with `npm test`; debug with `npm run test:ui`; verify the production build with `npm run test:prod`
- Use `page.locator()` for element selection
- Use `page.evaluate()` for testing custom events
- Every user-facing feature MUST have an E2E test; run the suite before considering any change complete
<!-- </TESTING-E2E> -->

<!-- <TESTING-BEHAVIORAL> -->
#### Behavioral Tests (BDD-style, Playwright)

- Place tests in `tests/behavioral/*.feature.spec.js`
- Run with `npm test` (they execute alongside the E2E suite)
- Structure every scenario with explicit Given / When / Then steps via `test.step()` — see `tests/behavioral/counter.feature.spec.js`
- Describe behavior from the user's point of view; assert only on what the user can observe, never on internal state
- Write the scenario first, then implement until it passes
<!-- </TESTING-BEHAVIORAL> -->

<!-- <TESTING-UNIT> -->
#### Unit Tests (Vitest)

- Use `vitest`; place tests in `tests/unit/*.test.js`
- Run with `npm run test:unit`
- Unit tests target pure logic only — no DOM, no dev server. Extract logic from components into `src/*-logic.js` modules (see `src/counter-logic.js`) and test those
- Assert exact values, not just definedness — weak assertions produce surviving mutants
- New logic MUST ship with unit tests in the same change
<!-- </TESTING-UNIT> -->


<!-- </TESTING-ANY> -->

### State Management

- **Attribute-first communication**: components talk to each other by setting attributes on each other's elements; treat attributes as the public API of every custom element (see Custom Elements section)
- Use component instance properties (`this.propertyName`) for private, internal state only
- Emit custom events to announce that something happened via `this.event('name', detail)` — but pass the data itself through attributes
- Listen to events via `this.on('name', callback)` or `this.once('name', callback)`

### HTTP Requests

- Use `this.getJSON(url)` for simple GET requests to JSON endpoints
- Use `this.call(endpoint, body)` for POST requests with auth/timeout support
- Always wrap in `try/catch` for error handling

## File Organization

| Directory | Purpose |
|-----------|---------|
| `src/` | JavaScript modules and components |
| `styles/` | CSS files (one per component or concern) |
| `md/` | Markdown pages, compiled to `dist/*.html` by `MarkdownPagesPlugin` |
<!-- <TESTING-ANY> -->
| `tests/` | Test files (see Testing section) |
<!-- </TESTING-ANY> -->
| `scripts/` | Build-time transformation scripts |
| `assets/` | Static files (images, fonts, etc.) |

## Prohibited Patterns

- ❌ TypeScript
- ❌ React/Vue/Angular/Svelte
- ❌ Shadow DOM
- ❌ CSS-in-JS (styled-components, emotion, etc.)
- ❌ Inline styles in JavaScript
- ❌ Framework-specific state managers (Redux, Pinia, etc.)
- ❌ jQuery or similar DOM wrappers
- ❌ `new Worker('./relative-path.js')` (use `new URL(..., import.meta.url)`)
