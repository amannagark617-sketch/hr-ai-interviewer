import PizZip from "pizzip";

// HR didn't use Word's actual Header/Footer feature for the letterhead+footer graphic on these
// templates — they pasted the same image in "Behind Text" mode once on every page (see each
// .docx's word/document.xml: a <wp:anchor behindDoc="1"> per page, all pointing at the same
// embedded picture, page-sized and page-positioned). mammoth (see docxToPdf.js) has no concept
// of Word pagination, so it just drops each anchored instance inline wherever its anchor
// paragraph happens to land in the reflowed HTML — the letterhead ends up floating mid-content
// once or twice instead of sitting behind every page like it does when the original .docx is
// opened in Word.
//
// This extracts those specific images directly from the .docx's own XML/relationships (not via
// mammoth) so docxToPdf.js can render each one as a genuinely repeating full-page background
// instead, and strip mammoth's own mis-placed inline copies of the same image out of the body
// HTML so it isn't rendered twice.
//
// Deliberately narrow: only <wp:anchor behindDoc="1"> images qualify — that's the specific OOXML
// signal for "this sits behind the text as a page background/letterhead," as opposed to a
// genuinely inline photo/logo that belongs wherever its paragraph puts it and should keep
// rendering exactly as mammoth already does.
export function extractBackgroundImages(docxBuffer) {
  const zip = new PizZip(docxBuffer);
  const documentXml = zip.file("word/document.xml")?.asText() || "";
  const relsXml = zip.file("word/_rels/document.xml.rels")?.asText() || "";

  const relMap = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
    relMap[m[1]] = m[2];
  }

  const seen = new Set(); // dedupe by media path — the same picture is anchored once per page
  const images = [];
  for (const m of documentXml.matchAll(/<wp:anchor\b[^>]*\bbehindDoc="1"[^>]*>[\s\S]*?<\/wp:anchor>/g)) {
    const embedMatch = m[0].match(/r:embed="([^"]+)"/);
    const target = embedMatch && relMap[embedMatch[1]];
    if (!target || seen.has(target)) continue;
    seen.add(target);

    // Targets in document.xml.rels are relative to word/ (e.g. "media/image1.png").
    const mediaPath = `word/${target}`;
    const file = zip.file(mediaPath);
    if (!file) continue;

    const ext = mediaPath.split(".").pop().toLowerCase();
    const mimeType = { jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" }[ext] || "image/png";
    images.push({ dataUri: `data:${mimeType};base64,${file.asNodeBuffer().toString("base64")}` });
  }
  return images;
}

// 914400 EMU per inch, 72 points per inch.
const EMU_PER_POINT = 914400 / 72;

function mimeTypeForPath(mediaPath) {
  const ext = mediaPath.split(".").pop().toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" }[ext] || "image/png";
}

// A PNG's pixel dimensions live at a fixed offset in its IHDR chunk (always the first chunk,
// right after the 8-byte signature): width at bytes 16-19, height at bytes 20-23, big-endian.
// Reading this directly avoids pulling in an image-decoding dependency just to get two integers.
function readPngPixelSize(buffer) {
  if (buffer.length < 24) return null;
  return { widthPx: buffer.readUInt32BE(16), heightPx: buffer.readUInt32BE(20) };
}

// Measured from Confirmation Letter's own badge anchor, which (unlike Appointment Letter's copies
// of the very same picture — see below) happens to use relativeFrom="page", so its intended
// position is knowable exactly, straight from the XML. Appointment Letter shares the identical
// page size/margins and the identical footer artwork (same header1.xml picture, same pgSz/pgMar —
// checked directly against both .docx files), so "how far down the page the badge belongs" is
// reused here as a template-family constant rather than re-derived per template.
const FOOTER_BADGE_TOP_OFFSET_EMU = 9162719;

// HR's newer template family (Appointment Letter, Confirmation Letter — see documentTemplates.js)
// drops the AmbitionBox rating badge onto the page as its own small floating picture, separate
// from the letterhead artwork above (which these templates instead supply via a real Word Header,
// something the older templates never used — see docxToPdfLocal's own comment on why that's fine).
// Neither mammoth nor Drive's importer reliably preserves a floating picture's exact position —
// mammoth ignores it entirely (see extractBackgroundImages' own comment), and Drive has already
// been observed re-rasterizing a background picture inconsistently between pages (see
// letterheadOverlay.js) — so the same "read the real position out of the XML, then draw it fresh"
// approach used for the letterhead is applied here too, at whatever spot HR actually intended,
// rather than trusting either renderer to reproduce it.
//
// Two different anchoring styles show up across the two templates, needing two different
// confidence levels to compute WHERE the badge belongs — but either way, the overlay always draws
// it on every generated page, same as the full-page letterhead: HR wants the badge consistently
// present (Appointment Letter's own first page never had it in the original, pasted per-page by
// hand, but should still get one) rather than a faithful reproduction of wherever it happened to
// land originally.
//
// - Confirmation Letter's badge uses <wp:positionV relativeFrom="page"> — an absolute offset from
//   the page's own top edge, independent of anything else on the page. This is real, exact
//   position, recoverable straight from the XML.
//
// - Appointment Letter instead pastes the very same picture once per page, each copy anchored
//   relative to whatever paragraph happens to be nearby (<wp:positionV relativeFrom="paragraph">)
//   at a slightly different offset each time — there's no fixed reference to recover an exact
//   position from, since where a paragraph-relative anchor actually lands depends on real
//   pagination (line wrapping, page breaks), which isn't knowable without simulating Word's own
//   layout engine. What multiple instances of the same picture DO reliably signal is "this is a
//   recurring per-page decoration, not one-off body content" — so this case reuses the shared
//   footer slot above for its vertical position, at this instance's own horizontal offset (which
//   stays consistent across instances even though the vertical one doesn't).
export function extractPageAnchoredDecorations(docxBuffer) {
  const zip = new PizZip(docxBuffer);
  const documentXml = zip.file("word/document.xml")?.asText() || "";
  const relsXml = zip.file("word/_rels/document.xml.rels")?.asText() || "";

  const relMap = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
    relMap[m[1]] = m[2];
  }

  const pageHeightTwips = Number(/<w:pgSz\b[^/]*\bw:h="(\d+)"/.exec(documentXml)?.[1] || 0);
  const leftMarginTwips = Number(/<w:pgMar\b[^/]*\bw:left="(\d+)"/.exec(documentXml)?.[1] || 0);
  if (!pageHeightTwips) return [];
  const pageHeightPt = pageHeightTwips / 20;
  const leftMarginPt = leftMarginTwips / 20;

  // Group every non-letterhead floating anchor by embed target first, rather than deciding
  // per-instance — Appointment Letter's fallback case specifically needs to see ALL of a target's
  // instances at once (to know it repeats) before it can decide it qualifies.
  const byTarget = new Map();
  for (const m of documentXml.matchAll(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/g)) {
    const block = m[0];
    // A behindDoc="1" anchor is exactly what extractBackgroundImages above already claims as the
    // full-page letterhead — Internship Joining Letter's own letterhead happens to also carry
    // relativeFrom="page" on one of its per-page copies, so without this exclusion it would get
    // picked up a second time here and drawn twice.
    if (/\bbehindDoc="1"/.test(block.slice(0, block.indexOf(">") + 1))) continue;

    const embedMatch = block.match(/r:embed="([^"]+)"/);
    const target = embedMatch && relMap[embedMatch[1]];
    const extentMatch = /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(block);
    if (!target || !extentMatch) continue;

    const isPageRelativeV = /<wp:positionV\b[^>]*\brelativeFrom="page"/.test(block);
    const posHOffset = Number(/<wp:positionH\b[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(block)?.[1] || 0);
    const posVOffset = Number(/<wp:positionV\b[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(block)?.[1] || 0);
    const hlinkRid = /<a:hlinkClick\b[^>]*\br:id="([^"]+)"/.exec(block)?.[1];

    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push({
      isPageRelativeV,
      posHOffset,
      posVOffset,
      widthPt: Number(extentMatch[1]) / EMU_PER_POINT,
      heightPt: Number(extentMatch[2]) / EMU_PER_POINT,
      linkUrl: hlinkRid ? relMap[hlinkRid] : undefined,
    });
  }

  const decorations = [];
  for (const [target, instances] of byTarget) {
    const exact = instances.find((i) => i.isPageRelativeV);
    // Multiple copies of the very same picture, pasted at slightly different paragraph-relative
    // offsets, is ambiguous on its own — Appointment Letter's own signature image does the exact
    // same thing (appears twice, once per signature block), and that one must NOT be moved to a
    // guessed footer position; it belongs wherever its own paragraph actually puts it. What's
    // specific to the badge is that it's wrapped in a hyperlink (see hlinkRid below) — a plain
    // signature or logo has no reason to link anywhere, so requiring a resolvable link here is
    // what actually distinguishes "this is the recurring badge" from "this is repeated inline
    // content that only happens to reuse the same picture."
    const linked = instances.find((i) => i.linkUrl);
    if (!exact && !linked) continue;
    const representative = exact || linked;

    const mediaPath = `word/${target}`;
    const file = zip.file(mediaPath);
    if (!file) continue;

    // None of these templates declare a real multi-column section, so positionH's "column"
    // reference (the only one seen in practice) is the same line as the page's left text margin.
    const xPt = leftMarginPt + representative.posHOffset / EMU_PER_POINT;
    // Word measures positionV down from the page's top edge to the image's own top edge; PDF
    // coordinates run bottom-up, so this flips it to the image's bottom edge from the page bottom.
    const topOffsetEmu = exact ? representative.posVOffset : FOOTER_BADGE_TOP_OFFSET_EMU;
    const yPt = pageHeightPt - topOffsetEmu / EMU_PER_POINT - representative.heightPt;

    const buffer = file.asNodeBuffer();
    const mimeType = mimeTypeForPath(mediaPath);
    const pixelSize = mimeType === "image/png" ? readPngPixelSize(buffer) : null;
    decorations.push({
      dataUri: `data:${mimeType};base64,${buffer.toString("base64")}`,
      widthPx: pixelSize?.widthPx || 0,
      heightPx: pixelSize?.heightPx || 0,
      xPt,
      yPt,
      widthPt: representative.widthPt,
      heightPt: representative.heightPt,
      linkUrl: representative.linkUrl,
    });
  }
  return decorations;
}
