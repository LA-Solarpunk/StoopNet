/**
 * Unit tests for the markdown page compiler used by MarkdownPagesPlugin.
 *
 * These are pure-logic tests (node environment, no DOM, no webpack) per
 * the vitest configuration; the plugin class is exercised by the build.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter,
  escapeHtml,
  typeToClass,
  renderMarkdownPage,
  entryAssetUrls,
} from '../../scripts/markdown-pages-plugin.js';

describe('parseFrontMatter', () => {
  it('splits a front matter block from the markdown body', () => {
    const { data, body } = parseFrontMatter(
      '---\ntitle: Notes\ntype: doc\n---\n\n# Heading\n'
    );

    expect(data).toEqual({ title: 'Notes', type: 'doc' });
    expect(body).toBe('\n# Heading\n');
  });

  it('treats a file without front matter as pure markdown', () => {
    const { data, body } = parseFrontMatter('# Just markdown\n');

    expect(data).toEqual({});
    expect(body).toBe('# Just markdown\n');
  });

  it('does not treat a --- divider inside the body as front matter', () => {
    const { data, body } = parseFrontMatter('# Top\n\n---\n\n# Bottom\n');

    expect(data).toEqual({});
    expect(body).toContain('# Top');
  });

  it('throws on invalid YAML so the build can report the file', () => {
    expect(() => parseFrontMatter('---\ntitle: [unclosed\n---\n\nbody\n'))
      .toThrow();
  });

  it('handles empty front matter as an empty object', () => {
    const { data } = parseFrontMatter('---\n---\n\nbody\n');

    expect(data).toEqual({});
  });
});

describe('escapeHtml', () => {
  it('escapes characters that would break out of text or attributes', () => {
    expect(escapeHtml('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;');
  });
});

describe('typeToClass', () => {
  it('passes simple values through', () => {
    expect(typeToClass('guide')).toBe('guide');
  });

  it('joins arrays into a class list', () => {
    expect(typeToClass(['doc', 'draft'])).toBe('doc draft');
  });

  it('returns an empty string for missing values', () => {
    expect(typeToClass(undefined)).toBe('');
    expect(typeToClass(null)).toBe('');
  });
});

describe('renderMarkdownPage', () => {
  const base = { filename: 'notes.md', source: '# Hi\n' };

  it('links the stylesheets and scripts it is given', () => {
    const html = renderMarkdownPage({
      ...base,
      styles: ['/index.css'],
      scripts: ['/index.js'],
    });

    expect(html).toContain('<link href="/index.css" rel="stylesheet">');
    expect(html).toContain('<script defer src="/index.js"></script>');
  });

  it('emits scripts in the given order so the runtime loads first', () => {
    const html = renderMarkdownPage({
      ...base,
      scripts: ['/runtime.js', '/main.js'],
    });

    expect(html.indexOf('/runtime.js')).toBeLessThan(html.indexOf('/main.js'));
  });

  it('omits asset tags when no styles or scripts are provided', () => {
    const html = renderMarkdownPage(base);

    expect(html).not.toContain('<link ');
    expect(html).not.toContain('<script ');
  });

  it('sets the type front matter value as the body class', () => {
    const html = renderMarkdownPage({
      ...base,
      source: '---\ntype: guide\n---\n\n# Hi\n',
    });

    expect(html).toContain('<body class="guide">');
  });

  it('omits the class attribute when there is no type', () => {
    const html = renderMarkdownPage(base);

    expect(html).toContain('<body>');
    expect(html).not.toContain('class=');
  });

  it('uses the title front matter value for <title>', () => {
    const html = renderMarkdownPage({
      ...base,
      source: '---\ntitle: Meeting Notes\n---\n\n# Hi\n',
    });

    expect(html).toContain('<title>Meeting Notes</title>');
  });

  it('falls back to the file name for <title>', () => {
    const html = renderMarkdownPage(base);

    expect(html).toContain('<title>notes</title>');
  });

  it('renders markdown into the body', () => {
    const html = renderMarkdownPage({
      ...base,
      source: '# Heading One\n\n- item\n',
    });

    expect(html).toContain('<h1>Heading One</h1>');
    expect(html).toContain('<li>item</li>');
  });

  it('escapes front matter values in attributes', () => {
    const html = renderMarkdownPage({
      ...base,
      source: "---\ntype: x\" onload=\"alert(1)\n---\n\n# Hi\n",
    });

    expect(html).toContain('<body class="x&quot; onload=&quot;alert(1)">');
    expect(html).not.toContain('onload="alert(1)"');
  });
});

describe('entryAssetUrls', () => {
  it('splits production entry files into stylesheet and script URLs', () => {
    expect(entryAssetUrls(['index.css', 'index.js'])).toEqual({
      styles: ['/index.css'],
      scripts: ['/index.js'],
    });
  });

  it('keeps dev order — runtime first, and no CSS when style-loader runs', () => {
    expect(entryAssetUrls(['runtime.js', 'main.js'])).toEqual({
      styles: [],
      scripts: ['/runtime.js', '/main.js'],
    });
  });

  it('ignores files that are neither stylesheets nor scripts', () => {
    expect(entryAssetUrls(['index.html', 'font.ttf'])).toEqual({
      styles: [],
      scripts: [],
    });
  });

  it('joins a non-root public path', () => {
    expect(entryAssetUrls(['main.js'], '/site/')).toEqual({
      styles: [],
      scripts: ['/site/main.js'],
    });
  });

  it('treats an auto public path as the site root', () => {
    expect(entryAssetUrls(['main.js'], 'auto')).toEqual({
      styles: [],
      scripts: ['/main.js'],
    });
  });
});

describe('wikilinks', () => {
  const base = { filename: 'notes.md' };

  it('renders [[target|label]] as a link to the sibling page', () => {
    const html = renderMarkdownPage({
      ...base,
      source: 'See [[test-file|Friendly Test File View]].\n',
    });

    expect(html).toContain('<a href="test-file.html">Friendly Test File View</a>');
  });

  it('uses the target as the link text when no pipe is given', () => {
    const html = renderMarkdownPage({
      ...base,
      source: 'See [[test-file]].\n',
    });

    expect(html).toContain('<a href="test-file.html">test-file</a>');
  });

  it('trims whitespace around target and label', () => {
    const html = renderMarkdownPage({
      ...base,
      source: 'See [[ test-file | Friendly ]].\n',
    });

    expect(html).toContain('<a href="test-file.html">Friendly</a>');
  });

  it('escapes the link text', () => {
    const html = renderMarkdownPage({
      ...base,
      source: 'See [[page|<b>bold</b>]].\n',
    });

    expect(html).toContain('<a href="page.html">&lt;b&gt;bold&lt;/b&gt;</a>');
  });

  it('URL-encodes targets with spaces in the href', () => {
    const html = renderMarkdownPage({
      ...base,
      source: 'See [[my page|My Page]].\n',
    });

    expect(html).toContain('<a href="my%20page.html">My Page</a>');
  });

  it('leaves [[…]] inside code spans alone', () => {
    const html = renderMarkdownPage({
      ...base,
      source: 'Use `[[test-file|not a link]]` literally.\n',
    });

    expect(html).toContain('<code>[[test-file|not a link]]</code>');
    expect(html).not.toContain('<a href=');
  });
});
