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
