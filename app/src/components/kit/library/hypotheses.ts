// The table of hypotheses/hypotheses.md as rows (issue 95). The file stays
// the source: its table has a column for the number (H1), the hypothesis,
// its status and the evidence so far, found by their header names. The words
// before and after the table are kept so the tab can show them too.

export type HypothesisRow = {
  id: string;
  number: number;
  text: string;
  status: string;
  evidence: string;
};

export type ParsedHypotheses = {
  before: string;
  rows: HypothesisRow[];
  after: string;
};

export const KNOWN_STATUSES = [
  "open",
  "supported",
  "contradicted",
  "dropped",
] as const;

// The cells of one table line, without the outer pipes. A pipe written as \|
// stays inside its cell.
const cellsOf = (line: string) => {
  let inner = line.trim();
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|") && !inner.endsWith("\\|")) inner = inner.slice(0, -1);
  return inner
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
};

const isTableLine = (line: string) => line.trim().startsWith("|");
const isSeparator = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export const parseHypotheses = (body: string): ParsedHypotheses => {
  const lines = body.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!isTableLine(lines[i]) || !isSeparator(lines[i + 1])) continue;
    const header = cellsOf(lines[i]).map((cell) => cell.toLowerCase());
    const at = {
      id: header.indexOf("#"),
      text: header.findIndex((cell) => cell.startsWith("hypothesis")),
      status: header.indexOf("status"),
      evidence: header.findIndex((cell) => cell.startsWith("evidence")),
    };
    if (at.id < 0 || at.text < 0) continue;
    let end = i + 2;
    const rows: HypothesisRow[] = [];
    for (; end < lines.length && isTableLine(lines[end]); end++) {
      const cells = cellsOf(lines[end]);
      const m = (cells[at.id] ?? "").match(/^H(\d+)$/);
      if (!m) continue;
      rows.push({
        id: `H${Number(m[1])}`,
        number: Number(m[1]),
        text: cells[at.text] ?? "",
        status:
          at.status >= 0 ? (cells[at.status] ?? "").replace(/`/g, "") : "",
        evidence: at.evidence >= 0 ? (cells[at.evidence] ?? "") : "",
      });
    }
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.number - b.number);
    return {
      before: lines.slice(0, i).join("\n").trim(),
      rows,
      after: lines.slice(end).join("\n").trim(),
    };
  }
  return { before: body, rows: [], after: "" };
};
