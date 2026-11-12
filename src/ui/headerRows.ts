/**
 * Shared title-row rule for the CSV and XLSX importers.
 *
 * The user's rule, identical for both formats: a file/sheet is
 * expected to be a table of data. Leading rows with at most one
 * non-empty cell (plus blank rows) are title rows and are skipped;
 * the first row with two or more non-empty cells is the header row.
 * Each skipped title row is reported, never dropped silently. A
 * file/sheet with no such row has no header row and is refused.
 *
 * Row numbers here are positions in the row list the caller passes
 * (0-based index + 1). The CSV caller passes its non-empty rows, so
 * the numbers match its existing ragged-row error numbering. The
 * XLSX caller maps the returned index back to the sheet row number.
 */

/** One skipped title row: its position in the row list, and its text. */
export interface SkippedTitleRow {
  /** 0-based index into the row list passed to `findHeaderRow`. */
  index: number;
  /** The title row's single non-empty cell, trimmed. */
  text: string;
}

/** Result of `findHeaderRow`. `headerIndex` is undefined when no row
 *  holds two or more non-empty cells (the caller refuses the file). */
export interface HeaderRowResult {
  headerIndex: number | undefined;
  skipped: SkippedTitleRow[];
}

/** Find the header row in a list of rows (each row is its cells as
 *  strings). Leading rows with at most one non-empty cell are title
 *  rows; blank rows are skipped silently. */
export function findHeaderRow(rows: readonly (readonly string[])[]): HeaderRowResult {
  const skipped: SkippedTitleRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const cells = rows[i] as readonly string[];
    const nonEmpty = cells.filter((cell) => cell.trim().length > 0);
    if (nonEmpty.length < 2) {
      if (nonEmpty.length === 1) {
        skipped.push({ index: i, text: (nonEmpty[0] as string).trim() });
      }
      continue;
    }
    return { headerIndex: i, skipped };
  }
  return { headerIndex: undefined, skipped };
}
