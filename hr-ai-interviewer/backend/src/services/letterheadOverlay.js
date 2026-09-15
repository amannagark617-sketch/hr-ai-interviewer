import { PDFDocument } from "pdf-lib";

// Draws the template's own letterhead image (see docxBackgroundImages.js) as a real full-bleed
// background on every page of an already-rendered PDF, regardless of which renderer produced that
// PDF (Drive's DOCX importer or the local mammoth+Puppeteer fallback — see docxToPdf.js).
//
// Neither renderer can be trusted to place this correctly on its own: the source .docx doesn't use
// a real Word Header/Footer for it, just the same image pasted "behind text" once per page, so
// mammoth drops every instance but the first it happens to reflow past, and Drive's Google Docs
// importer appears to drop these page-anchored pasted images entirely (nothing from it survives
// into the exported PDF). Compositing it in afterward, directly onto the final, already-paginated
// PDF, sidesteps both renderers' handling of it completely — there's no reflow or pagination
// ambiguity left to get wrong once every page's exact size is already fixed.
//
// pdf-lib has no native/system dependencies (pure JS), so this works under buildpack-only hosting
// (Google AI Studio's deploy flow, Cloud Run source deploys) same as everything else in this app.
export async function overlayLetterheadOnEveryPage(pdfBytes, backgroundImages) {
  if (!backgroundImages.length) return pdfBytes;

  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();

  const { dataUri } = backgroundImages[0];
  const isJpeg = dataUri.startsWith("data:image/jpeg") || dataUri.startsWith("data:image/jpg");
  const imageBytes = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
  const image = isJpeg ? await outDoc.embedJpg(imageBytes) : await outDoc.embedPng(imageBytes);

  const embeddedPages = await outDoc.embedPages(srcDoc.getPages());
  for (const embeddedPage of embeddedPages) {
    const { width, height } = embeddedPage;
    const page = outDoc.addPage([width, height]);
    // Background first (bottom-most layer), then the original page's own content drawn on top —
    // this is what makes the body text/tables from the original render sit visibly in front of the
    // letterhead rather than under it.
    page.drawImage(image, { x: 0, y: 0, width, height });
    page.drawPage(embeddedPage, { x: 0, y: 0, width, height });
  }

  return Buffer.from(await outDoc.save());
}
