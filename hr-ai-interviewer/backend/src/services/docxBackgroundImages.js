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

// HR's newer template family (Appointment Letter, Confirmation Letter — see documentTemplates.js)
// drops the AmbitionBox rating badge onto the page as its own small floating picture, separate
// from the letterhead artwork above (which these templates instead supply via a real Word Header,
// something the older templates never used — see docxToPdfLocal's own comment on why that's fine).
// Neither mammoth nor Drive's importer reliably preserves a floating picture's exact position —
// mammoth ignores it entirely (see extractBackgroundImages' own comment), and Drive has already
// been observed re-rasterizing a background picture inconsistently between pages (see
// letterheadOverlay.js) — so the same "read the real position out of the XML, then draw it fresh"
// approach used for the letterhead is applied here too, at whatever exact spot HR actually placed
// it, rather than trusting either renderer to reproduce it.
//
// This only recovers position for the one case where it's actually knowable without simulating
// Word's page layout: a <wp:positionV relativeFrom="page"> anchor gives an absolute offset from
// the page's own top edge, independent of anything else on the page. A paragraph- or line-relative
// anchor (as Appointment Letter's own copy of this same badge happens to use, pasted once per page
// at a slightly different offset each time) has no such fixed reference — where it actually lands
// depends on real pagination, which isn't recoverable from the XML alone, so those are left alone
// entirely rather than guessing.
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

  const seen = new Set();
  const decorations = [];
  for (const m of documentXml.matchAll(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/g)) {
    const block = m[0];
    // A behindDoc="1" anchor is exactly what extractBackgroundImages above already claims as the
    // full-page letterhead — Internship Joining Letter's own letterhead happens to also carry
    // relativeFrom="page" on one of its per-page copies, so without this exclusion it would get
    // picked up a second time here and drawn twice.
    if (/\bbehindDoc="1"/.test(block.slice(0, block.indexOf(">") + 1))) continue;
    if (!/<wp:positionV\b[^>]*\brelativeFrom="page"/.test(block)) continue;

    const embedMatch = block.match(/r:embed="([^"]+)"/);
    const target = embedMatch && relMap[embedMatch[1]];
    if (!target || seen.has(target)) continue;

    const extentMatch = /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(block);
    if (!extentMatch) continue;
    const posHOffset = Number(/<wp:positionH\b[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(block)?.[1] || 0);
    const posVOffset = Number(/<wp:positionV\b[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(block)?.[1] || 0);

    const mediaPath = `word/${target}`;
    const file = zip.file(mediaPath);
    if (!file) continue;
    seen.add(target);

    const widthPt = Number(extentMatch[1]) / EMU_PER_POINT;
    const heightPt = Number(extentMatch[2]) / EMU_PER_POINT;
    // None of these templates declare a real multi-column section, so positionH's "column"
    // reference (the only one seen in practice) is the same line as the page's left text margin.
    const xPt = leftMarginPt + posHOffset / EMU_PER_POINT;
    // Word measures positionV down from the page's top edge to the image's own top edge; PDF
    // coordinates run bottom-up, so this flips it to the image's bottom edge from the page bottom.
    const yPt = pageHeightPt - posVOffset / EMU_PER_POINT - heightPt;

    const buffer = file.asNodeBuffer();
    const mimeType = mimeTypeForPath(mediaPath);
    const pixelSize = mimeType === "image/png" ? readPngPixelSize(buffer) : null;
    // The badge is wrapped in its own hyperlink in the source .docx (so it's clickable there too,
    // in whatever way Word's own picture-hyperlink support renders) — reusing that same URL here
    // means the redrawn version keeps being a real link in the generated PDF, without hand-coding
    // which URL any given decoration should point to.
    const hlinkRid = /<a:hlinkClick\b[^>]*\br:id="([^"]+)"/.exec(block)?.[1];
    const linkUrl = hlinkRid ? relMap[hlinkRid] : undefined;
    decorations.push({
      dataUri: `data:${mimeType};base64,${buffer.toString("base64")}`,
      widthPx: pixelSize?.widthPx || 0,
      heightPx: pixelSize?.heightPx || 0,
      xPt,
      yPt,
      widthPt,
      heightPt,
      linkUrl,
    });
  }
  return decorations;
}
