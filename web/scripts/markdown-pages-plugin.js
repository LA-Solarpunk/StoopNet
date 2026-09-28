/**
 * Markdown Pages Plugin for Webpack
 *
 * Compiles every markdown file in `md/` into a standalone HTML page in the
 * output directory:
 *
 *   md/meeting-notes.md  →  dist/meeting-notes.html
 *
 * Each generated page is a full HTML document that links the assets the
 * entry actually emitted (discovered from the compilation, so both build
 * modes work):
 *
 *   production: <link href="/index.css"> + <script defer src="/index.js">
 *   dev:        <script defer src="/runtime.js"> + <script defer src="/main.js">
 *               (styles are injected by style-loader, so there is no CSS file)
 *
 * YAML front matter (a `---` delimited block at the top of the file) is
 * parsed and removed before the markdown is rendered:
 *
 *   - `type`:  value becomes a class on the generated <body>
 *   - `title`: becomes the document <title> (falls back to the file name)
 *   - anything else is ignored
 *
 * The pure helpers (parseFrontMatter, renderMarkdownPage) are kept free of
 * webpack imports so they can be unit tested with vitest.
 *
 * @module markdown-pages-plugin
 */

import fs from 'fs';
import path from 'path';
import { load as loadYaml } from 'js-yaml';
import { Marked } from 'marked';

/**
 * Inline markdown extension for wikilinks: `[[target|label]]` becomes
 * `<a href="target.html">label</a>`, pointing at the compiled sibling
 * page. Without a pipe, the target itself is the link text
 * (`[[test-file]]` → `test-file.html`). Link text and href are escaped /
 * URL-encoded; content inside code spans and code blocks is left alone.
 *
 * @type {object} marked TokenizerAndRendererExtension
 */
export const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start(src) {
    return src.indexOf('[[');
  },
  tokenizer(src) {
    const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
    if (!match) {
      return undefined;
    }
    return {
      type: 'wikilink',
      raw: match[0],
      target: match[1].trim(),
      text: (match[2] ?? match[1]).trim(),
    };
  },
  renderer(token) {
    const href = `${encodeURIComponent(token.target)}.html`;
    return `<a href="${href}">${escapeHtml(token.text)}</a>`;
  },
};

/** Markdown renderer configured for page compilation (wikilinks enabled). */
const markdown = new Marked();
markdown.use({ extensions: [wikilink] });

/**
 * Split a markdown source string into YAML front matter data and body.
 *
 * Front matter is a `---` delimited block that must start on the first
 * line of the file. Files without front matter are treated as pure
 * markdown with an empty data object.
 *
 * @param {string} source Raw markdown source
 * @returns {{data: object, body: string}} Parsed front matter and markdown body
 * @throws {Error} If the front matter block is not valid YAML
 */
export function parseFrontMatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) {
    return { data: {}, body: source };
  }
  const loaded = loadYaml(match[1]);
  return {
    data: loaded && typeof loaded === 'object' ? loaded : {},
    body: match[2],
  };
}

/**
 * Escape a string for safe interpolation into HTML text or attributes.
 *
 * @param {string} value Raw string value
 * @returns {string} Escaped string
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Normalize a front matter `type` value into a body class string.
 *
 * Arrays become space-separated class lists; other values are stringified.
 *
 * @param {*} value Raw `type` value from front matter
 * @returns {string} Class list string (empty when there is no usable value)
 */
export function typeToClass(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join(' ');
  }
  return String(value).trim();
}

/**
 * Turn the files emitted for the entry chunks into site-root URLs grouped
 * by kind, preserving emission order (dev's runtime chunk stays ahead of
 * the entry bundle, which `defer` requires). Non CSS/JS files are ignored.
 *
 * @param {string[]} files Files emitted for the entry chunks
 * @param {string} [publicPath] Output public path ('auto' is treated as '/')
 * @returns {{styles: string[], scripts: string[]}} URLs for <link>/<script> tags
 */
export function entryAssetUrls(files, publicPath = '/') {
  const base = !publicPath || publicPath === 'auto' ? '/' : publicPath;
  const styles = [];
  const scripts = [];
  for (const file of files) {
    const url = `${base.endsWith('/') ? base : `${base}/`}${file}`;
    if (file.endsWith('.css')) {
      styles.push(url);
    } else if (file.endsWith('.js')) {
      scripts.push(url);
    }
  }
  return { styles, scripts };
}

/**
 * Render one markdown file into a complete HTML page.
 *
 * @param {object} options
 * @param {string} options.filename Markdown file name (used for the
 *   fallback <title> and error messages)
 * @param {string} options.source Raw markdown source with optional
 *   YAML front matter
 * @param {string[]} [options.styles] Stylesheet URLs for <link> tags
 * @param {string[]} [options.scripts] Script URLs for <script defer> tags
 * @returns {string} Complete HTML document
 * @throws {Error} If the front matter block is not valid YAML
 */
export function renderMarkdownPage({
  filename,
  source,
  styles = [],
  scripts = [],
}) {
  const { data, body } = parseFrontMatter(source);

  const title = data.title !== undefined && data.title !== null
    ? String(data.title)
    : path.basename(filename, path.extname(filename));
  const typeClass = typeToClass(data.type);
  const content = markdown.parse(body);

  const assetTags = [
    ...styles.map(
      (href) => `  <link href="${escapeHtml(href)}" rel="stylesheet">`
    ),
    ...scripts.map(
      (src) => `  <script defer src="${escapeHtml(src)}"></script>`
    ),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
${assetTags}
</head>
<body${typeClass ? ` class="${escapeHtml(typeClass)}"` : ''}>
${content}
</body>

</html>
`;
}

/**
 * Webpack plugin that compiles md/ into HTML pages on every build.
 *
 * The markdown directory is registered as a context dependency, so
 * `webpack serve` rebuilds pages when files are added, changed or removed.
 */
export class MarkdownPagesPlugin {
  /**
   * @param {object} [options]
   * @param {string} [options.context] Absolute path to the markdown
   *   directory (default: `<project>/md`)
   */
  constructor({ context } = {}) {
    this.context = context;
  }

  apply(compiler) {
    const mdDir = path.resolve(
      this.context ?? path.join(compiler.options.context ?? process.cwd(), 'md')
    );

    compiler.hooks.thisCompilation.tap('MarkdownPagesPlugin', (compilation) => {
      // Watch the whole directory so added/removed files trigger rebuilds.
      compilation.contextDependencies.add(mdDir);

      /**
       * Emit after HtmlWebpackPlugin has produced the app shell
       * (html-webpack-plugin 5.x emits at PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE),
       * so md/index.md can override dist/index.html.
       */
      compilation.hooks.processAssets.tap(
        {
          name: 'MarkdownPagesPlugin',
          stage:
            compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE + 1,
        },
        () => {
          /**
           * Link whatever the entry actually emitted in this mode: dev runs
           * style-loader (no CSS file) with runtime.js + main.js, production
           * extracts index.css and names the bundle index.js.
           */
          const entryFiles = [];
          for (const entrypoint of compilation.entrypoints.values()) {
            entryFiles.push(...entrypoint.getFiles());
          }
          const { styles, scripts } = entryAssetUrls(
            entryFiles,
            compiler.options.output.publicPath
          );

          let files = [];
          try {
            files = fs
              .readdirSync(mdDir)
              .filter((file) => file.endsWith('.md'))
              .sort();
          } catch {
            return; // No md/ directory (yet) — nothing to compile.
          }

          for (const file of files) {
            try {
              const source = fs.readFileSync(path.join(mdDir, file), 'utf-8');
              const html = renderMarkdownPage({
                filename: file,
                source,
                styles,
                scripts,
              });
              const name = `${path.basename(file, path.extname(file))}.html`;
              /**
               * An md page overrides an existing asset of the same name
               * (md/index.md replaces the HtmlWebpackPlugin shell). Deleting
               * first avoids the "multiple assets emit different content"
               * conflict error.
               */
              if (compilation.getAsset(name)) {
                compilation.deleteAsset(name);
              }
              compilation.emitAsset(
                name,
                new compiler.webpack.sources.RawSource(html)
              );
            } catch (error) {
              compilation.errors.push(new compiler.webpack.WebpackError(
                `[markdown-pages] Failed to compile ${file}: ${error.message}`
              ));
            }
          }
        }
      );
    });
  }
}
