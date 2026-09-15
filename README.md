# Folio — static PDF book reader

A static site that opens a PDF with a two-page spread and a page-turn animation. Host the folder on **GitHub Pages**, Netlify, or any other static file host. Opening `index.html` as a `file://` URL will usually fail because PDF.js needs HTTP.

## Serve locally

```bash
npx --yes serve .
```

Then open the printed URL (typically `http://localhost:3000`).


## Controls

- Click a page edge, swipe/drag, or use `←` `→`
- Scrubber and page field jump without flipping through every sheet
- `S` single page vs spread (spread is default on wide screens)
- `F` fullscreen
