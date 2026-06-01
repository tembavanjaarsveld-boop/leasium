export type CsvCellValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvCellValue): string {
  const raw = value == null ? "" : String(value);
  const safeValue = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function csvRows(rows: CsvCellValue[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
