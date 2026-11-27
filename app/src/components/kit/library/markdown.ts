// The library's markdown as HTML (issue 95). Its own instance of the app's
// `marked`, so upstream's markdown is left as it is. Three rules on top of
// plain markdown:
//   - raw HTML in a file is shown as text, never drawn: a <script> reads as
//     "<script>" on the page and runs nothing;
//   - a ```mermaid block becomes a placeholder holding its code as text,
//     which LibraryMarkdown turns into a picture (or leaves as code, with a
//     one line error, when the diagram is broken);
//   - a hypothesis number (H8, [H8]) links to its row on the hypotheses tab.
// What comes out is sanitized with DOMPurify all the same, as a second wall.
import DOMPurify from "dompurify";
import {
  Marked,
  type TokenizerExtension,
  type RendererExtension,
} from "marked";

import { hypothesisHref, libraryHref, SECTION_KEYS } from "./types";

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// H8 or H12, standing alone (not PH8, not H8x).
const hypothesisRef: TokenizerExtension & RendererExtension = {
  name: "hypothesisRef",
  level: "inline",
  start(src) {
    const m = src.match(/(?<![A-Za-z0-9_])H\d{1,3}(?![A-Za-z0-9_])/);
    return m?.index;
  },
  tokenizer(src) {
    const m = src.match(/^H(\d{1,3})(?![A-Za-z0-9_])/);
    if (m) {
      return { type: "hypothesisRef", raw: m[0], id: `H${Number(m[1])}` };
    }
  },
  renderer(token) {
    const id = token.id as string;
    return `<a href="${hypothesisHref(id)}" data-hypothesis="${id}">${escapeHtml(token.raw)}</a>`;
  },
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// A link to another .md file of the library, written relative to this page,
// as the path of that page; anything else, null.
export const libraryPathOf = (href: string, from: string): string | null => {
  if (SCHEME.test(href) || href.startsWith("#") || href.startsWith("/"))
    return null;
  const target = href.split("#")[0];
  if (!target.endsWith(".md")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  const path = parts.join("/");
  return (SECTION_KEYS as readonly string[]).includes(parts[0]) ? path : null;
};

const SAFE_LINK = /^(https?:|mailto:)/i;

const makeMarked = (pagePath: string) =>
  new Marked({
    gfm: true,
    extensions: [hypothesisRef],
    renderer: {
      html({ text, block }: { text: string; block?: boolean }) {
        const shown = escapeHtml(text);
        return block ? `<p class="whitespace-pre-wrap">${shown}</p>` : shown;
      },
      code({ text, lang }) {
        const language = (lang ?? "").trim().split(/\s+/)[0];
        if (language === "mermaid") {
          return `<div data-mermaid><pre><code>${escapeHtml(text)}</code></pre></div>\n`;
        }
        return `<pre><code>${escapeHtml(text)}</code></pre>\n`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        const page = libraryPathOf(href, pagePath);
        if (page) {
          return `<a href="${libraryHref(page)}" data-library-path="${escapeHtml(page)}">${text}</a>`;
        }
        if (!SAFE_LINK.test(href)) return text;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
      // A picture is never loaded from elsewhere: it becomes a link to it.
      image({ href, text }) {
        const label = escapeHtml(`picture: ${text || href}`);
        if (!SAFE_LINK.test(href)) return label;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      },
    },
  });

export const renderLibraryMarkdown = (
  body: string,
  pagePath: string,
): string => {
  const html = makeMarked(pagePath).parse(body, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["img", "style", "iframe", "form", "input", "svg", "math"],
  });
};
