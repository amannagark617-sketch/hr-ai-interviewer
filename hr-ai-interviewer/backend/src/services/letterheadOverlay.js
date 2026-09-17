import { PDFDocument, PDFName, PDFString, PDFDict, PDFRawStream, PDFNumber } from "pdf-lib";

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

// Any embedded image at least this large (in either dimension, source pixels) is treated as a
// leftover full-page background rather than genuine small content — see neutralizeLargeImages
// below for why this exists at all. Comfortably above the letterhead's own inline extras (the
// AmbitionBox badge at 270px, a signature at a similar scale) and comfortably below every
// letterhead background variant seen so far (1447-1813px wide) — anything this big showing up
// inside a rendered page's own content has no legitimate reason to be there.
const LARGE_IMAGE_THRESHOLD_PX = 400;

// Draws the template's own letterhead image (see docxBackgroundImages.js) as a real full-bleed
// background on every page of an already-rendered PDF, regardless of which renderer produced that
// PDF (Drive's DOCX importer or the local mammoth+Puppeteer fallback — see docxToPdf.js).
//
// Neither renderer can be trusted to place this correctly on its own: the source .docx doesn't use
// a real Word Header/Footer for it, just the same image pasted "behind text" once per page (in some
// templates, literally once per page — Internship Joining Letter had 6 separate copies). mammoth
// drops every instance but the first it happens to reflow past. Drive's Google Docs importer was
// assumed to drop these entirely, based on one document where nothing survived — but a real
// generated PDF proved that wrong: Drive actually keeps a re-rasterized copy of the image on *some*
// pages and not others (inconsistent per page, at a different resolution each time it's
// re-encoded), which is exactly the "the background looks different / shifts between pages"
// complaint this was meant to fix in the first place. Since that leftover copy is part of the
// original page's own content — drawn on top of this function's own clean background, in the same
// z-order as the real body text — it was silently winning every time, making the compositing below
// look like it was doing nothing.
//
// neutralizeLargeImages (below) removes that ambiguity at the source: before the original page's
// content is drawn on top of the new background, any large embedded image already inside it gets
// replaced with a fully transparent 1x1 placeholder, so whatever Drive did or didn't preserve can
// no longer render at all — only this function's own background, drawn once per page in a single
// consistent way, ends up visible.
//
// pdf-lib has no native/system dependencies (pure JS), so this works under buildpack-only hosting
// (Google AI Studio's deploy flow, Cloud Run source deploys) same as everything else in this app.
export async function overlayLetterheadOnEveryPage(pdfBytes, backgroundImages) {
  if (!backgroundImages.length) return pdfBytes;

  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();

  for (const page of srcDoc.getPages()) {
    neutralizeLargeImages(srcDoc, page, LARGE_IMAGE_THRESHOLD_PX);
  }

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
    // letterhead rather than under it. Any leftover background image the original content itself
    // held has already been neutralized above, so this is the only background that can render.
    page.drawImage(image, { x: 0, y: 0, width, height });
    page.drawPage(embeddedPage, { x: 0, y: 0, width, height });
    addLinkAnnotation(outDoc, page, badgeRectForPage(width, height), BADGE_LINK_URL);
  }

  return Buffer.from(await outDoc.save());
}

// Walks one page's own (top-level) XObject resources and replaces any Image at least
// LARGE_IMAGE_THRESHOLD_PX wide or tall with a shared, fully transparent 1x1 placeholder — a
// same-size RGB pixel with an all-black (fully transparent) soft mask, so it renders as nothing
// regardless of whatever scale/position the page's own content stream draws it at. Reused across
// every neutralized image in the whole document (via the pdfDoc-scoped cache below) rather than
// creating a new placeholder object per image, since there's nothing image-specific about it.
function neutralizeLargeImages(pdfDoc, page, thresholdPx) {
  const resources = page.node.Resources();
  const xobjRef = resources?.get(PDFName.of("XObject"));
  if (!xobjRef) return;
  const xobjDict = pdfDoc.context.lookup(xobjRef);
  if (!(xobjDict instanceof PDFDict)) return;

  for (const key of xobjDict.keys()) {
    const obj = pdfDoc.context.lookup(xobjDict.get(key));
    if (!obj?.dict) continue;
    if (obj.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    const width = obj.dict.get(PDFName.of("Width"));
    const height = obj.dict.get(PDFName.of("Height"));
    const w = width instanceof PDFNumber ? width.asNumber() : 0;
    const h = height instanceof PDFNumber ? height.asNumber() : 0;
    if (w >= thresholdPx || h >= thresholdPx) {
      xobjDict.set(key, getTransparentPlaceholder(pdfDoc));
    }
  }
}

function getTransparentPlaceholder(pdfDoc) {
  if (pdfDoc.__transparentPlaceholderRef) return pdfDoc.__transparentPlaceholderRef;
  const maskStream = PDFRawStream.of(
    pdfDoc.context.obj({ Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceGray", BitsPerComponent: 8 }),
    Buffer.from([0]),
  );
  const maskRef = pdfDoc.context.register(maskStream);
  const imageStream = PDFRawStream.of(
    pdfDoc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: 1,
      Height: 1,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      SMask: maskRef,
    }),
    Buffer.from([0, 0, 0]),
  );
  const imageRef = pdfDoc.context.register(imageStream);
  pdfDoc.__transparentPlaceholderRef = imageRef;
  return imageRef;
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
