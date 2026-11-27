// The Library (issue 95): hypotheses, research, competition notes and
// diagrams, read in the hub next to the people and interviews. The files in
// the repo are the source; library_pages holds the latest copy, readable only
// by a signed in, switched on teammate. Four tabs, one per folder; a folder
// with several pages lists them, and the first (or the one in ?page=) opens.
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";

import { HubPage } from "../HubPage";
import { useHubRows } from "../hubApi";
import { HypothesesView } from "./HypothesesView";
import { LibraryMarkdown } from "./LibraryMarkdown";
import {
  fileUrl,
  HYPOTHESES_FILE,
  libraryPath,
  PAGE_COLUMNS,
  PAGE_LINE_COLUMNS,
  SECTIONS,
  type LibraryPage,
} from "./types";

type Section = (typeof SECTIONS)[number];

export const Library = () => {
  const { section = "hypotheses" } = useParams();
  const current = SECTIONS.find((s) => s.key === section);

  return (
    <HubPage title="Library">
      <div className="flex flex-col gap-4">
        <nav aria-label="Library" className="flex flex-wrap gap-1 border-b">
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              to={`/library/${s.key}`}
              aria-current={s.key === section ? "page" : undefined}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
                s.key === section
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        {current ? (
          <SectionView key={current.key} section={current} />
        ) : (
          <p className="text-sm text-muted-foreground">
            The library has no section by this name.
          </p>
        )}
      </div>
    </HubPage>
  );
};

const SectionView = ({ section }: { section: Section }) => {
  const [params] = useSearchParams();
  const { rows: pages, error } = useHubRows<LibraryPage>("library_pages", {
    filter: { section: section.key },
    sort: { field: "path", order: "ASC" },
    columns: PAGE_LINE_COLUMNS,
  });

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        The library could not be loaded.
      </p>
    );
  }
  if (!pages) return null;
  if (pages.length === 0) {
    return <p className="text-sm text-muted-foreground">{section.empty}</p>;
  }
  const wanted = params.get("page");
  const open =
    pages.find((p) => p.path === wanted) ??
    pages.find((p) => p.path === HYPOTHESES_FILE) ??
    pages[0];

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {pages.length > 1 ? (
        <ul
          aria-label="Pages"
          className="flex flex-col gap-1 text-sm md:w-60 md:shrink-0"
        >
          {pages.map((p) => (
            <li key={p.path}>
              <Link
                to={libraryPath(p.path)}
                aria-current={p.path === open.path ? "page" : undefined}
                className={cn(
                  "block rounded px-2 py-1 break-words",
                  p.path === open.path
                    ? "bg-muted font-medium"
                    : "hover:bg-muted/60",
                )}
              >
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="min-w-0 flex-1">
        <PageView key={open.path} path={open.path} />
      </div>
    </div>
  );
};

const PageView = ({ path }: { path: string }) => {
  const navigate = useNavigate();
  const { rows, error } = useHubRows<LibraryPage>("library_pages", {
    filter: { path },
    sort: { field: "path", order: "ASC" },
    columns: PAGE_COLUMNS,
    perPage: 1,
  });
  const page = rows?.[0];

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        This page could not be loaded.
      </p>
    );
  }
  if (!rows) return null;
  if (!page) {
    return (
      <p className="text-sm text-muted-foreground">
        This page is no longer in the library.
      </p>
    );
  }
  return (
    <article className="flex flex-col gap-3">
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span className="font-mono">{page.path}</span>
        <a
          href={fileUrl(page)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:no-underline"
        >
          {`from commit ${page.commit.slice(0, 7)}`}
        </a>
      </p>
      {page.path === HYPOTHESES_FILE ? (
        <HypothesesView page={page} onNavigate={navigate} />
      ) : (
        <LibraryMarkdown
          body={page.body}
          path={page.path}
          onNavigate={navigate}
        />
      )}
    </article>
  );
};
