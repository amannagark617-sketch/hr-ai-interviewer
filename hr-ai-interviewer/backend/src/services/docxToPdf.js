import mammoth from "mammoth";
import puppeteer from "puppeteer";
import { extractBackgroundImages } from "./docxBackgroundImages.js";

// Converts a filled-in .docx (see documentTemplates.js) to a PDF, so HR gets both formats without
// needing Word/LibreOffice installed anywhere. There's no Word-rendering engine available in a
// plain Node process, so this goes through mammoth (already a dependency — see resumeParser.js)
// to turn the .docx into HTML first, then prints that HTML to PDF with a real browser (Chromium,
// via Puppeteer). This keeps every table and inline image from the original template intact —
// mammoth carries embedded images straight through as data URIs — but it is NOT a pixel-identical
// re-render of the .docx: exact fonts don't survive the HTML round-trip, and any image Word
// treated as inline-with-a-paragraph (rather than the page-background letterhead handled
// separately below) lands wherever mammoth's reflowed HTML puts it, which can differ slightly
// from its exact position in the original template.
//
// The letterhead+footer graphic is the one exception, and gets special handling: see
// docxBackgroundImages.js for why mammoth alone can't place it correctly (it's pasted "behind
// text" once per page in the source .docx, not a normal Header/Footer) and how this reproduces
// that as a real repeating full-page background instead.

// Launching Chromium takes real time (roughly half a second to a couple of seconds) and memory
// (order of 100-200MB) — paying that cost on every single PDF would make document generation feel
// slow and would fight the rest of this app for resources on a small Cloud Run instance. Launch
// once, lazily, on first use, and keep reusing the same browser process for every request after
// that; only re-launch if it's gone away (crashed, or this is truly the first call).
let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.connected) return existing;
    browserPromise = null; // it died — fall through and relaunch
  }
  browserPromise = puppeteer.launch({
    headless: true,
    // --no-sandbox is required in most containerized environments (Cloud Run included) since
    // Chromium's own sandboxing needs kernel namespace permissions the container doesn't grant —
    // this is Puppeteer's own documented recommendation for exactly this kind of deployment, not
    // a security downgrade specific to this app (the page content here is our own generated HTML,
    // never arbitrary/untrusted user-supplied HTML or URLs).
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return browserPromise;
}

// mammoth still emits its own inline copy of each background image wherever its anchor
// paragraph landed (once per page it was pasted on in the original .docx) — now that
// docxToPdf renders it separately as a real repeating background, those inline copies would
// otherwise show the same letterhead twice. Strip every <img> tag whose src is exactly one of
// the extracted background data URIs; matching on the full data URI is reliable because it's the
// very same base64 payload every time — same embedded picture, just pasted onto multiple pages.
//
// Plain string search-and-splice rather than a regex: a background image's data URI easily runs
// to several hundred KB of base64, and handing that to `new RegExp(...)` blows past V8's regex
// pattern-length limit ("Invalid regular expression") — plain indexOf has no such ceiling.
function stripInlineBackgroundImages(html, backgroundImages) {
  let result = html;
  for (const { dataUri } of backgroundImages) {
    let searchFrom = 0;
    while (true) {
      const uriIndex = result.indexOf(dataUri, searchFrom);
      if (uriIndex === -1) break;
      const tagStart = result.lastIndexOf("<img", uriIndex);
      const tagEnd = result.indexOf(">", uriIndex);
      if (tagStart === -1 || tagEnd === -1) {
        searchFrom = uriIndex + dataUri.length;
        continue;
      }
      result = result.slice(0, tagStart) + result.slice(tagEnd + 1);
      searchFrom = tagStart; // resume from here in case another instance follows
    }
  }
  return result;
}

// Measured directly off the templates' own letterhead image (1813x2564px, i.e. A4-proportioned):
// the logo + rule line occupies roughly the top 11%, and the red contact-info footer bar plus
// the address/phone line below it occupies roughly the bottom 12% of the page. Body text needs to
// stay clear of both on every page, not just the first/last, so these are real page.pdf() margins
// (see docxToPdf below) rather than CSS padding on the content — padding on one long flowing div
// only ever applies once, at the very top of page 1 and the very bottom of the last page; actual
// print margins are what Chromium re-applies as blank space on every single generated page.
const PAGE_TOP_MARGIN = "34mm"; // clears the logo + rule line (~11% of 297mm) with headroom
const PAGE_BOTTOM_MARGIN = "40mm"; // clears the footer bar + phone/address line (~12%) with headroom
const PAGE_SIDE_MARGIN = "18mm";
const PAGE_HEIGHT_MM = 297; // A4
const PAGE_WIDTH_MM = 210;
const NO_IMAGE_TOP_MARGIN = "20mm"; // fallback for a template with no letterhead image at all
const NO_IMAGE_BOTTOM_MARGIN = "20mm";

// Wraps mammoth's raw HTML output in a minimal print stylesheet — A4 page size, bordered tables,
// and images capped to a sane width so an embedded signature/inline photo never blows out to
// full-page size the way an un-styled <img> would.
//
// The letterhead image itself is NOT rendered here as a position:fixed body layer — that was
// tried first and repeats correctly across pages, but Chromium's print engine doesn't reliably
// anchor a fixed-position element to each page's own top/bottom edge, so the logo/footer landed
// at inconsistent, wrong vertical offsets (overlapping body text) on different pages. Puppeteer's
// headerTemplate/footerTemplate (see docxToPdf below) is the purpose-built mechanism for content
// that must repeat inside a fixed-height band on every page, so that's used instead — see
// buildHeaderFooterTemplates below for how the same full-page image is clipped into a top strip
// and a bottom strip using plain CSS (no image cropping/re-encoding needed).
function wrapHtml(bodyHtml) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #1d1d1f;
    margin: 0;
  }
  p { margin: 0 0 10px; }
  strong, b { font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 16px; font-size: 10pt; }
  table td, table th { border: 1px solid #ccc; padding: 6px 10px; text-align: left; vertical-align: top; }
  img { max-width: 220px; display: block; margin: 0 auto 14px; }
  h1, h2, h3 { margin: 0 0 10px; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// Puppeteer renders headerTemplate/footerTemplate as their own tiny standalone HTML documents,
// sized to exactly PAGE_TOP_MARGIN/PAGE_BOTTOM_MARGIN tall and the full page width — and, crucially
// for this, genuinely reprinted fresh on every single page rather than fought over by print
// pagination the way a body-level position:fixed layer was. Each template gets an overflow:hidden
// window showing only the relevant strip of the SAME full letterhead image: the header window sits
// at the image's natural top (top: 0), the footer window is shifted up by the image's full height
// minus the footer band's own height, so only its bottom slice is visible. No cropping/re-encoding
// of the raster image is needed — it's the same trick as a CSS sprite.
function buildHeaderFooterTemplates(backgroundImages) {
  if (!backgroundImages.length) return null;
  const { dataUri } = backgroundImages[0];
  const topMarginMm = parseFloat(PAGE_TOP_MARGIN);
  const bottomMarginMm = parseFloat(PAGE_BOTTOM_MARGIN);
  const footerShiftMm = PAGE_HEIGHT_MM - bottomMarginMm;

  const bandStyle = (heightMm) =>
    `width:${PAGE_WIDTH_MM}mm;height:${heightMm}mm;overflow:hidden;position:relative;margin:0;padding:0;`;
  const imgStyle = (topMm) =>
    `position:absolute;top:-${topMm}mm;left:0;width:${PAGE_WIDTH_MM}mm;height:${PAGE_HEIGHT_MM}mm;display:block;`;

  const headerTemplate = `<div style="${bandStyle(topMarginMm)}"><img src="${dataUri}" style="${imgStyle(0)}"></div>`;
  const footerTemplate = `<div style="${bandStyle(bottomMarginMm)}"><img src="${dataUri}" style="${imgStyle(footerShiftMm)}"></div>`;
  return { headerTemplate, footerTemplate };
}

// Returns { html, pdf } — html is kept around only for debugging/inspection, callers normally
// just want pdf (a Buffer).
export async function docxToPdf(docxBuffer) {
  const backgroundImages = extractBackgroundImages(docxBuffer);
  const { value: rawBodyHtml } = await mammoth.convertToHtml({ buffer: docxBuffer }, { includeDefaultStyleMap: true });
  const bodyHtml = stripInlineBackgroundImages(rawBodyHtml, backgroundImages);
  const html = wrapHtml(bodyHtml);
  const headerFooter = buildHeaderFooterTemplates(backgroundImages);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const rawPdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: !!headerFooter,
      headerTemplate: headerFooter?.headerTemplate || "<div></div>",
      footerTemplate: headerFooter?.footerTemplate || "<div></div>",
      margin: {
        top: headerFooter ? PAGE_TOP_MARGIN : NO_IMAGE_TOP_MARGIN,
        bottom: headerFooter ? PAGE_BOTTOM_MARGIN : NO_IMAGE_BOTTOM_MARGIN,
        left: PAGE_SIDE_MARGIN,
        right: PAGE_SIDE_MARGIN,
      },
    });
    // Puppeteer's page.pdf() resolves a plain Uint8Array, not a Node Buffer — Express's res.send
    // only recognizes an actual Buffer as binary; anything else (Uint8Array included) it silently
    // JSON-serializes as {"0":37,"1":80,...}, which is a real, working PDF byte-for-byte until it
    // gets mangled that way. Wrap it so every caller downstream (route handlers, base64 encoding
    // for Drive) gets a real Buffer without needing to know about this.
    const pdf = Buffer.from(rawPdf);
    return { html, pdf };
  } finally {
    await page.close();
  }
}

// Called once at process shutdown (see index.js) so a killed/redeployed instance doesn't leave a
// orphaned Chromium process behind.
export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => {});
}
