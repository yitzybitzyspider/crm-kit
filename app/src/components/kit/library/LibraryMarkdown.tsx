// One library page's markdown on screen (issue 95). The HTML comes from
// renderLibraryMarkdown (raw HTML shown as text, sanitized). Each ```mermaid
// block is then drawn as a picture by the pinned `mermaid` library, loaded
// only when a page has one. A diagram that cannot be drawn keeps its code on
// screen with one line saying why, and the rest of the page is unaffected.
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

import { renderLibraryMarkdown } from "./markdown";
import { hypothesisPath, libraryPath } from "./types";

type Mermaid = (typeof import("mermaid"))["default"];

let mermaidLoad: Promise<Mermaid> | null = null;
const loadMermaid = () =>
  (mermaidLoad ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // labels are text, never HTML; links and scripts in a diagram are off
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: document.documentElement.classList.contains("dark")
        ? "dark"
        : "default",
    });
    return mermaid;
  }));

let drawn = 0;

const firstLine = (error: unknown) => {
  const text =
    (error as { message?: string })?.message ??
    (typeof error === "string" ? error : "unknown error");
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "unknown error"
  ).slice(0, 200);
};

const drawDiagrams = async (box: HTMLElement, cancelled: () => boolean) => {
  const blocks = [...box.querySelectorAll<HTMLElement>("[data-mermaid]")];
  if (blocks.length === 0) return;
  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    mermaidLoad = null;
    for (const block of blocks) showError(block, error);
    return;
  }
  for (const block of blocks) {
    if (cancelled()) return;
    const source = block.querySelector("code")?.textContent ?? "";
    const id = `library-mermaid-${++drawn}`;
    try {
      await mermaid.parse(source);
      const { svg } = await mermaid.render(id, source);
      if (cancelled()) return;
      block.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ["style"],
      });
      // a wide diagram keeps its own size and scrolls sideways, so its
      // words stay readable instead of shrinking to fit
      const drawing = block.querySelector("svg");
      if (drawing?.style.maxWidth) {
        drawing.style.width = drawing.style.maxWidth;
        drawing.style.maxWidth = "none";
      }
    } catch (error) {
      // mermaid may leave its scratch element behind when it fails
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      if (cancelled()) return;
      showError(block, error);
    }
  }
};

const showError = (block: HTMLElement, error: unknown) => {
  if (block.querySelector("[data-mermaid-error]")) return;
  const line = document.createElement("p");
  line.setAttribute("data-mermaid-error", "");
  line.setAttribute("role", "alert");
  line.className = "text-sm text-destructive";
  line.textContent = `This diagram could not be drawn: ${firstLine(error)}`;
  block.append(line);
};

const PROSE = cn(
  "text-sm leading-6 break-words",
  "[&_p]:my-3 [&_p:first-child]:mt-0",
  "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h1:first-child]:mt-0",
  "[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2",
  "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2",
  "[&_h4]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1",
  "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-muted-foreground",
  "[&_a]:text-primary [&_a]:underline [&_a:hover]:no-underline",
  "[&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2 [&_li]:my-1",
  "[&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono",
  "[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-3 [&_pre_code]:p-0",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto",
  "[&_th]:border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top",
  "[&_hr]:border-t [&_hr]:my-4",
  "[&_[data-mermaid]]:my-4 [&_[data-mermaid]]:overflow-x-auto [&_[data-mermaid]_svg]:h-auto",
);

export const LibraryMarkdown = ({
  body,
  path,
  onNavigate,
  className,
}: {
  body: string;
  // the page's own path, so a relative link to another page can be followed
  path: string;
  // in-app navigation for a hypothesis or page link; without it the link's
  // own address (after the #) is followed
  onNavigate?: (to: string) => void;
  className?: string;
}) => {
  const html = useMemo(() => renderLibraryMarkdown(body, path), [body, path]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    let cancelled = false;
    void drawDiagrams(box, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [html]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onNavigate) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[data-hypothesis], a[data-library-path]",
    );
    if (!link) return;
    event.preventDefault();
    const { hypothesis, libraryPath: page } = link.dataset;
    onNavigate(
      hypothesis ? hypothesisPath(hypothesis) : libraryPath(page ?? ""),
    );
  };

  return (
    <div
      ref={ref}
      data-testid="library-markdown"
      className={cn(PROSE, className)}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
