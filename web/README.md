# Pochade-JS Project

A vanilla JS, CSS and HTML project with Web Workers and Custom HTML Elements as first class citizens. Pages can also be authored in markdown.

## Getting Started

Install dependencies:

```bash
npm install
```

<!-- <TESTING-PLAYWRIGHT> -->
Install Playwright browsers (required for testing):

```bash
npx playwright install
```
<!-- </TESTING-PLAYWRIGHT> -->

## Running the Project

To run the project in development mode:

```bash
npm start
```

This will start a development server. By default, it runs on port 3000. You can view the project in your browser.

## Building the Project

To build the project for production:

```bash
npm run build
```

This creates a `dist` folder containing:

- `index.html` — the app shell generated from the template, links the other
  two files. **`md/index.md` overrides it** (see [Markdown Pages](#markdown-pages)).
- `index.js` — the bundled and minified JavaScript
- `index.css` — the extracted and minified styles
- one `*.html` page per `md/*.md` file, plus anything copied from `assets/`

### Markdown Pages

Every markdown file in `md/` is compiled into an HTML page in `dist/`:

```bash
md/meeting-notes.md  →  dist/meeting-notes.html
```

`md/index.md` is special: it overrides the generated app shell, so the
compiled markdown is served as the site's `index.html`.

Each generated page is a full HTML document that links the shared
stylesheet and bundle (`<link href="/index.css">`,
`<script defer src="/index.js">`), so all custom elements and styles from
`index.js` / `index.css` are available on the page.

YAML front matter (a `---` delimited block at the top of the file) is
parsed and removed:

- `type` — its value becomes a class on the generated `<body>`
  (e.g. `type: guide` → `<body class="guide">`). Arrays become
  space-separated class lists.
- `title` — becomes the document `<title>` (falls back to the file name).
- Anything else is ignored.

#### Wikilinks

Markdown bodies support wikilinks to other compiled pages:

- `[[test-file|Friendly Test File View]]` renders as
  `<a href="test-file.html">Friendly Test File View</a>`
- `[[test-file]]` renders as `<a href="test-file.html">test-file</a>`

The link text is HTML-escaped, the href is URL-encoded, and wikilinks
inside code spans and code blocks are left untouched.

Invalid YAML fails the build with the offending file named. The markdown
directory is watched in development: adding, changing or removing files
rebuilds the pages.

### Size Budget

The build enforces a distribution size budget on the `dist` folder (measured
on disk, 1 MiB = 1024 * 1024 bytes):

- **warning** if the output is larger than 2 MiB
- **error** (build fails with a non-zero exit) if the output is larger than 3 MiB

Limits can be customized via `SIZE_WARN_MB` and `SIZE_ERROR_MB` (see
[Environment Configuration](#environment-configuration)). A per-file
breakdown is printed whenever a limit is exceeded, so it's obvious where
to cut.

<!-- <TESTING-ANY> -->
## Testing

<!-- <TESTING-PLAYWRIGHT> -->
Run the Playwright end-to-end and behavioral test suites:

```bash
npm test
```

Run tests with the Playwright UI for debugging:

```bash
npm test:ui
```

Run tests against the production build:

```bash
npm test:prod
```
<!-- </TESTING-PLAYWRIGHT> -->

<!-- <TESTING-UNIT> -->
Run the unit tests:

```bash
npm run test:unit
```
<!-- </TESTING-UNIT> -->


<!-- </TESTING-ANY> -->

## Customizing the Build

You can customize the build output by creating a `.env` file in the root of the project.

### Output Filename

To change the name of the emitted JavaScript bundle, set the
`OUTPUT_FILE_NAME` variable in your `.env` file.

**.env**
```
OUTPUT_FILE_NAME=my-custom-filename.js
```

If this variable is not set, the bundle defaults to `dist/index.js`.
The HTML is always `dist/index.html` and the CSS is always `dist/index.css`.

### Size Budget

To change the distribution size budget, set `SIZE_WARN_MB` and
`SIZE_ERROR_MB` in your `.env` file (in MiB; the build warns above the
first and fails above the second).

**.env**
```
SIZE_WARN_MB=1.5
SIZE_ERROR_MB=2.5
```

If these variables are not set, the limits default to 2 MiB (warn) and
3 MiB (error).

### Development Server Port

You can also change the development server port by setting the `PORT` variable in your `.env` file.

**.env**
```
PORT=8080
```

If this variable is not set, the port will default to `3000`.

### CSS Output

In production builds CSS is always extracted to a separate `dist/index.css`
file (via `mini-css-extract-plugin`). In development, styles are injected
into the DOM via JavaScript (`style-loader`) to support hot reloading.

## Project Structure

- `src/` - Your JavaScript source files
- `styles/` - CSS files
- `md/` - Markdown pages, compiled to HTML at build time
<!-- <TESTING-ANY> -->
- `tests/` - Test files
<!-- </TESTING-ANY> -->
- `scripts/` - Build scripts (including Web Worker transformation)
- `index.html` - Main HTML file
- `index.js` - Main JavaScript entry point
- `index.css` - Main CSS file
- `webpack.config.js` - Webpack configuration
<!-- <TESTING-PLAYWRIGHT> -->
- `playwright.config.js` - Playwright test configuration
<!-- </TESTING-PLAYWRIGHT> -->
<!-- <TESTING-UNIT> -->
- `vitest.config.js` - Vitest unit test configuration
<!-- </TESTING-UNIT> -->


## Webpack Build Configuration

### Features

The project uses Webpack with the following features configured:

#### Module Processing

- **CSS Processing Pipeline**
  - `style-loader` - Injects CSS into the DOM
  - `css-loader` - Resolves CSS imports and URLs
  - `postcss-loader` with cssnano - Minifies and optimizes CSS
  - Source maps enabled in development mode
  - Automatic comment removal in production builds

- **JavaScript Processing**
  - `swc-loader` - Fast JavaScript transpilation
  - Custom `transform-workers.js` loader - Transforms web worker imports
  - Dynamic imports forced to eager mode for web worker compatibility
  - Source maps enabled in development mode

#### Web Workers

The build system includes special handling for web workers:

- Custom loader (`scripts/transform-workers.js`) transforms worker imports
- Dynamic imports are eagerly evaluated for worker compatibility
- Workers are properly bundled and can be imported in your code

#### Assets Directory

The `assets/` folder receives special treatment:

- **Development Server**: Assets are served from the root path (`/`) if the directory exists and contains files
- **Production Build**: Assets are copied to the dist root (not in a subdirectory) via `CopyWebpackPlugin`
- **Conditional Loading**: Assets are only processed if the directory exists and has files

Place any static files (images, fonts, etc.) in the `assets/` directory and they will be accessible from the root path in both dev and production.

#### Optimization

- `splitChunks: false` - Bundles everything into a single file
- `runtimeChunk: false` - No separate runtime chunk
- `clean: true` - Automatically cleans the dist directory before each build
- Terser (via `minimizer-webpack-plugin`) runs an extra compress pass and
  drops legal comments instead of extracting them to a `LICENSE.txt` file
- Webpack's built-in performance hints are disabled; the
  [size budget](#size-budget) is the authoritative size check

#### Size Budget

- `SizeBudgetPlugin` (`scripts/size-budget-plugin.js`) measures the dist
  folder after every production build
- Warns above `SIZE_WARN_MB` (default 2 MiB), fails the build above
  `SIZE_ERROR_MB` (default 3 MiB)
- Prints a per-file breakdown whenever a limit is exceeded

#### Development Server

- Serves static files from project root
- Conditionally serves assets directory
- Gzip compression enabled
- Cache-Control headers set to `no-store` for development
- Configurable port via environment variable

#### Environment Configuration

- `.env` file support via dotenv
- `OUTPUT_FILE_NAME` - Customize bundle filename (default: `index.js`)
- `PORT` - Configure dev server port (default: `3000`)
- `SIZE_WARN_MB` - Output size warning threshold in MiB (default: `2`)
- `SIZE_ERROR_MB` - Output size failure threshold in MiB (default: `3`)
- `NODE_ENV` - Set to `production` for production builds

## Technologies

- **Webpack** - Fast bundler for development and production
- **dataroom-js** - Custom HTML elements framework
- **Web Workers** - For parallel processing
- **PostCSS** - CSS processing with cssnano optimization
- **SWC** - Fast JavaScript/TypeScript compiler
<!-- <TESTING-PLAYWRIGHT> -->
- **Playwright** - End-to-end and behavioral testing
<!-- </TESTING-PLAYWRIGHT> -->
<!-- <TESTING-UNIT> -->
- **Vitest** - Unit testing
<!-- </TESTING-UNIT> -->


## Publishing to npm

This project is configured for publishing to npm. Follow these steps to publish:

### Before First Publish

1. **Update package metadata** in `package.json`:
   - Set the package `name` (must be unique on npm)
   - Update `author` with your name and email
   - Update `repository`, `bugs`, and `homepage` URLs with your actual repository
   - Set the initial `version` (recommend starting with `0.1.0`)

2. **Verify the package contents**:
   ```bash
   npm pack --dry-run
   ```
   This shows what files will be included in the package.

3. **Test the build**:
   ```bash
   npm run build
   ```
   Ensure the `dist/` directory is created successfully.

<!-- <TESTING-ANY> -->
4. **Run the tests**:
   ```bash
   npm test
   ```
<!-- </TESTING-ANY> -->

### Publishing

1. **Login to npm** (first time only):
   ```bash
   npm login
   ```

2. **Publish the package**:
   ```bash
   npm publish
   ```
   
   The `prepublishOnly` script will automatically run the build before publishing.

### Updating the Package

1. **Update the version** using npm's version command:
   ```bash
   npm version patch  # For bug fixes (1.0.0 -> 1.0.1)
   npm version minor  # For new features (1.0.0 -> 1.1.0)
   npm version major  # For breaking changes (1.0.0 -> 2.0.0)
   ```

2. **Publish the update**:
   ```bash
   npm publish
   ```

### What Gets Published

The package includes:
- `dist/` - Built production files
- `src/` - Source JavaScript files
- `styles/` - CSS files
- `index.js`, `index.css`, `index.html` - Entry files
- `package.json` and related metadata

Development files (webpack config, build scripts, tests, etc.) are excluded via `.npmignore`.
