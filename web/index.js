/**
 * Main Entry Point
 *
 * This is the primary JavaScript entry point for the webpack build.
 * It imports the global CSS and all custom element modules.
 *
 * Webpack follows this dependency graph to bundle everything into
 * a single output file (or split chunks if configured).
 *
 * For LLMs: When adding a new component:
 *   1. Create the component file in src/
 *   2. Add an import statement below
 *   3. If the component needs styles, create a CSS file in styles/
 *   4. Import the CSS in index.css (not here — keep JS and CSS separate)
 */

// Global styles: imported first so they are available before components render
import './index.css';

// Stoop Net components
import './src/stoop-id.js';
import './src/stoop-chat.js';
