# Link previews

The initial `index.html` includes Open Graph and large-image Twitter card metadata.
Messages and other crawlers can read it without starting the JavaScript game.
The canonical share URL is https://www.roadsterrampage.com/.

The cover is `public/social/roadster-rampage-v1.jpg` (1200 × 630 JPEG).
The Apple touch icon is a 180 × 180 PNG rendered from the existing favicon SVG.
Neither asset adds a request to the game's normal startup path.

## Updating the cover

Use a new versioned filename and update both image URLs in `index.html`; social
apps cache images. Keep the dimensions, MIME type and alt text accurate. All
URLs in the social metadata must be absolute public HTTPS URLs.

Build with `npm run build`, then check the metadata in `dist/index.html` and
the image under `dist/social/`. After production deployment, check that both
the page and the image URL return HTTP 200 without authentication. Send the
production URL as a new message to check the actual Messages rendering;
previously sent previews may retain cached metadata. Preview deployments can
serve the asset directly, but their metadata intentionally points at production.

References: [Apple Messages rich previews](https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages)
and [Open Graph](https://ogp.me/).

## Artwork source

Generated with the built-in imagegen tool using `docs/images/title.jpg` and
`docs/images/gameplay.jpg` as visual references. Promotional artwork, not a
gameplay screenshot. Final generation prompt:

> undefined
