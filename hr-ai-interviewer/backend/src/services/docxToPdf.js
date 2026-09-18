import mammoth from "mammoth";
import puppeteer from "puppeteer";
import { extractBackgroundImages } from "./docxBackgroundImages.js";
import { convertDocxToPdfViaDrive } from "./sheetsService.js";
import { overlayLetterheadOnEveryPage } from "./letterheadOverlay.js";

// Converts a filled-in .docx (see documentTemplates.js) to a PDF, so HR gets both formats without
// needing Word installed anywhere.
//
// Preferred path: hand the .docx to Drive's own importer (via convertDocxToPdfViaDrive, see
// Code.gs's convertDocxToPdf) — the same real, Word-layout-aware renderer behind "open in Google
// Docs," which reproduces direct formatting (cell shading, tinted callout boxes, letter-spaced
// headings) that the fallback below cannot. This needs Sheets logging configured
// (APPS_SCRIPT_WEB_APP_URL) since it's the same Apps Script deployment that already handles Drive
// access — see convertDocxToPdfViaDrive for what happens when it isn't.
//
// Fallback path (docxToPdfLocal below): only used when Drive conversion is unavailable or fails.
// Goes through mammoth (already a dependency — see resumeParser.js) to turn the .docx into HTML,
// then prints that HTML to PDF with headless Chromium (Puppeteer). This keeps every table and
// inline image from the original template intact — mammoth carries embedded images straight
// through as data URIs — but it is NOT a pixel-identical re-render of the .docx: mammoth only
// preserves semantic HTML (bold/tables/paragraphs), so direct Word formatting like cell shading,
// background colors, and letter-spacing is lost.
//
// Either way, the letterhead — a single image pasted "behind text" once per page in the source
// .docx rather than a real Header/Footer — is deliberately NOT handled by either renderer above.
// Neither can place it correctly: mammoth has no concept of Word's pagination so it drops every
// repeated instance but the one its reflowed HTML happens to land near, and Drive's importer
// appears to drop these page-anchored pasted images outright. Instead, see letterheadOverlay.js:
// it's composited directly onto the finished PDF's pages afterward, once page boundaries are
// already fixed and unambiguous, regardless of which renderer produced the rest of the page.
export async function docxToPdf(docxBuffer) {
  const backgroundImages = extractBackgroundImages(docxBuffer);

  let pdf;
  try {
    pdf = await convertDocxToPdfViaDrive(docxBuffer);
  } catch (err) {
    console.error("[docxToPdf] Drive-based conversion failed, falling back to the local renderer:", err.message);
  }
  if (!pdf) {
    pdf = await docxToPdfLocal(docxBuffer, backgroundImages);
  }

  const finalPdf = await overlayLetterheadOnEveryPage(pdf, backgroundImages);
  return { pdf: finalPdf };
}

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

// mammoth still emits its own inline copy of the letterhead image wherever its anchor paragraph
// landed (once per page it was pasted on in the original .docx) — since letterheadOverlay.js draws
// it in separately afterward as a real per-page background, those inline copies would otherwise
// show the same image twice. Strip every <img> tag whose src is exactly one of the extracted
// background data URIs; matching on the full data URI is reliable because it's the very same
// base64 payload every time — same embedded picture, just pasted onto multiple pages.
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
// rather than CSS padding on the content — padding on one long flowing div only ever applies once,
// at the very top of page 1 and the very bottom of the last page; actual print margins are what
// Chromium re-applies as blank space on every single generated page.
const PAGE_TOP_MARGIN = "34mm"; // clears the logo + rule line (~11% of 297mm) with headroom
const PAGE_BOTTOM_MARGIN = "40mm"; // clears the footer bar + phone/address line (~12%) with headroom
const PAGE_SIDE_MARGIN = "18mm";
const NO_IMAGE_TOP_MARGIN = "20mm"; // fallback for a template with no letterhead image at all
const NO_IMAGE_BOTTOM_MARGIN = "20mm";

// Wraps mammoth's raw HTML output in a minimal print stylesheet — A4 page size, bordered tables,
// and images capped to a sane width so an embedded signature/inline photo never blows out to
// full-page size the way an un-styled <img> would. The letterhead itself is deliberately not drawn
// here at all (see the module comment above and letterheadOverlay.js) — this only needs to leave
// clear margin space for it, via docxToPdfLocal's page.pdf() call below.
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

async function docxToPdfLocal(docxBuffer, backgroundImages) {
  const { value: rawBodyHtml } = await mammoth.convertToHtml({ buffer: docxBuffer }, { includeDefaultStyleMap: true });
  const bodyHtml = stripInlineBackgroundImages(rawBodyHtml, backgroundImages);
  const html = wrapHtml(bodyHtml);
  const hasLetterhead = backgroundImages.length > 0;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const rawPdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: hasLetterhead ? PAGE_TOP_MARGIN : NO_IMAGE_TOP_MARGIN,
        bottom: hasLetterhead ? PAGE_BOTTOM_MARGIN : NO_IMAGE_BOTTOM_MARGIN,
        left: PAGE_SIDE_MARGIN,
        right: PAGE_SIDE_MARGIN,
      },
    });
    // Puppeteer's page.pdf() resolves a plain Uint8Array, not a Node Buffer — Buffer.from() here
    // keeps every caller downstream (letterheadOverlay's pdf-lib load, route handlers, base64
    // encoding for Drive) working with a real Buffer without needing to know about that distinction.
    return Buffer.from(rawPdf);
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
