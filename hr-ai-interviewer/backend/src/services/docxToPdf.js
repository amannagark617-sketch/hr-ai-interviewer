import mammoth from "mammoth";
import puppeteer from "puppeteer";

// Converts a filled-in .docx (see documentTemplates.js) to a PDF, so HR gets both formats without
// needing Word/LibreOffice installed anywhere. There's no Word-rendering engine available in a
// plain Node process, so this goes through mammoth (already a dependency — see resumeParser.js)
// to turn the .docx into HTML first, then prints that HTML to PDF with a real browser (Chromium,
// via Puppeteer). This keeps the letterhead image, signature image, and every table from the
// original template intact — mammoth carries embedded images straight through as data URIs — but
// it is NOT a pixel-identical re-render of the .docx: exact fonts and the precise on-page position
// of anything Word treated as a floating/anchored image (the letterhead here) don't survive the
// HTML round-trip, so those can land in a slightly different spot than in the original template.

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

// Wraps mammoth's raw HTML output in a minimal print stylesheet — A4 page size, generous margins,
// bordered tables, and images capped to a sane width so an embedded letterhead/signature never
// blows out to full-page size the way an un-styled <img> would.
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

// Returns { html, pdf } — html is kept around only for debugging/inspection, callers normally
// just want pdf (a Buffer).
export async function docxToPdf(docxBuffer) {
  const { value: bodyHtml } = await mammoth.convertToHtml({ buffer: docxBuffer }, { includeDefaultStyleMap: true });
  const html = wrapHtml(bodyHtml);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const rawPdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" },
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
