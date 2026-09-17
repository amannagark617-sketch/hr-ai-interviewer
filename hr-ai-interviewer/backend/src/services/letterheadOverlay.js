import { PDFDocument, PDFName, PDFString } from "pdf-lib";

// The AmbitionBox rating badge baked into the letterhead image (bottom-right corner, above the
// footer bar) should link to the company's actual AmbitionBox page, but a raster image has no
// concept of "part of me is a hyperlink" — Word can only make an *entire* picture clickable, which
// would make the whole page background a link, not just the badge. A PDF, on the other hand, can
// carry an invisible Link annotation positioned over just that one region (see
// addLinkAnnotationToEveryPage below), so the badge is clickable only in the generated PDF, not the
// .docx — there's no equivalent mechanism in Word for "clickable region of a background image."
//
// These fractions were measured directly off the letterhead image (badge bounding box relative to
// full page width/height) and describe the SAME rectangle on every page, since the same full
// letterhead — badge included — is drawn identically on every page by the overlay below.
const BADGE_LINK_URL = "https://www.ambitionbox.com/overview/little-nap-recliners-overview";
const BADGE_LINK_BOX = { leftFrac: 1965 / 2481, topFrac: 3020 / 3508, rightFrac: 2300 / 2481, bottomFrac: 3180 / 3508 };

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
    addLinkAnnotation(outDoc, page, badgeRectForPage(width, height), BADGE_LINK_URL);
  }

  return Buffer.from(await outDoc.save());
}

// Converts the badge's fixed fraction-of-page bounding box into an actual point rectangle for one
// page's exact dimensions. Image coordinates run top-down (0 at the top); PDF rectangles run
// bottom-up (0 at the bottom), so the fractions get flipped on the way in.
function badgeRectForPage(pageWidth, pageHeight) {
  const { leftFrac, topFrac, rightFrac, bottomFrac } = BADGE_LINK_BOX;
  return {
    x: leftFrac * pageWidth,
    y: (1 - bottomFrac) * pageHeight,
    width: (rightFrac - leftFrac) * pageWidth,
    height: (bottomFrac - topFrac) * pageHeight,
  };
}

// pdf-lib has no high-level "add a link" helper — a Link annotation is built directly as a PDF
// object and attached to the page's own Annots array. Border is set to all-zero (no visible
// rectangle/underline drawn) since the badge image itself is already the visible affordance; this
// annotation only needs to be clickable, not to look like anything.
function addLinkAnnotation(pdfDoc, page, { x, y, width, height }, url) {
  const linkAnnotation = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "URI",
      URI: PDFString.of(url),
    },
  });
  const annotationRef = pdfDoc.context.register(linkAnnotation);
  const existingAnnots = page.node.lookup(PDFName.of("Annots"));
  if (existingAnnots) {
    existingAnnots.push(annotationRef);
  } else {
    page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([annotationRef]));
  }
}
