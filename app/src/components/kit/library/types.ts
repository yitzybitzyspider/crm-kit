// The library as the screens read it (issue 95): one row of library_pages per
// markdown file of hypotheses/, research/, competition/ and diagrams/, copied
// from the repo by scripts/sync_library.py.

export type LibraryPage = {
  path: string;
  section: SectionKey;
  title: string;
  body: string;
  commit: string;
  updated_at: string;
};

export const SECTIONS = [
  {
    key: "hypotheses",
    label: "Hypotheses",
    empty: "No hypotheses yet. Tell Claude: add a hypothesis to hypotheses.",
  },
  {
    key: "research",
    label: "Research",
    empty: "No research yet. Tell Claude: add this paper to research.",
  },
  {
    key: "competition",
    label: "Competition",
    empty:
      "No competition notes yet. Tell Claude: add this competitor to competition.",
  },
  {
    key: "diagrams",
    label: "Diagrams",
    empty: "No diagrams yet. Tell Claude: draw this as a diagram in diagrams.",
  },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);

// The page list never carries bodies; one page's body is read when it opens.
export const PAGE_LINE_COLUMNS = [
  "path",
  "section",
  "title",
  "commit",
  "updated_at",
] as const;
export const PAGE_COLUMNS = [...PAGE_LINE_COLUMNS, "body"] as const;

// The file the hypotheses tab draws as rows.
export const HYPOTHESES_FILE = "hypotheses/hypotheses.md";

const REPO = "https://github.com/your-org/crm-kit";
export const fileUrl = (page: Pick<LibraryPage, "path" | "commit">) =>
  `${REPO}/blob/${page.commit}/${page.path.split("/").map(encodeURIComponent).join("/")}`;

// Addresses inside the hub. The app's router keeps the page after a #, so a
// link drawn into markdown carries it; a click is caught and routed in place.
export const libraryPath = (path: string) =>
  `/library/${path.split("/")[0]}?page=${encodeURIComponent(path)}`;
export const libraryHref = (path: string) => `#${libraryPath(path)}`;
export const hypothesisPath = (id: string) => `/library/hypotheses?h=${id}`;
export const hypothesisHref = (id: string) => `#${hypothesisPath(id)}`;
