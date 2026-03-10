import * as cheerio from "cheerio";

export function normalizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function decodeEntityEscapedHtml(value: string): string {
  return cheerio.load(`<body>${value}</body>`)("body").text();
}

export function normalizeHtml(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (looksLikeHtml(normalized)) {
    return normalized;
  }
  const decoded = decodeEntityEscapedHtml(normalized).trim();
  if (decoded && looksLikeHtml(decoded)) {
    return decoded;
  }
  return normalized;
}

function extractTextFromHtml(value: string): string {
  const $ = cheerio.load(`<body>${value}</body>`);
  $("br").replaceWith("\n");
  $("li").each((_, element) => {
    $(element).prepend("- ");
    $(element).append("\n");
  });
  $("p,div,section,article,h1,h2,h3,h4,h5,h6,tr").append("\n");
  return $("body").text();
}

export function htmlToText(value: string | null | undefined): string | null {
  const normalizedHtml = normalizeHtml(value);
  if (!normalizedHtml) {
    return null;
  }
  let text = normalizeText(extractTextFromHtml(normalizedHtml));
  if (!text) {
    return null;
  }
  if (looksLikeHtml(text)) {
    text = normalizeText(extractTextFromHtml(text));
  }
  return text;
}

export function mergeTextBlocks(values: Array<string | null | undefined>): string | null {
  const merged = values
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value));
  if (merged.length === 0) {
    return null;
  }
  return merged.join("\n\n");
}
