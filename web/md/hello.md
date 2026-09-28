---
title: Hello StoopNet
type: guide
---

# Hello, StoopNet

This page is compiled from `md/hello.md` at build time. The front matter
above gives the document its title, and `type: guide` becomes a class on
the `<body>` element.

## What the compiler does

- Renders markdown (headings, lists, `code`, quotes) to HTML
- Links the shared stylesheet and script: `/index.css` and `/index.js`
- Maps the `type` front matter key to a class on `<body>`

## Linking pages

Wikilinks point at other compiled pages: [[hello|back to this page]]
links here, while `[[other-page|a friendly name]]` would link to
`other-page.html` (just `[[other-page]]` uses the page name as the
link text).

## Styling this page

The shared stylesheet applies everywhere. Page-specific styling can target
the body class:

```css
body.guide {
  /* guide-specific styles */
}
```
