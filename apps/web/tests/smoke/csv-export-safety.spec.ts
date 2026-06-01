import { expect, test } from "@playwright/test";

import { csvCell, csvRows } from "../../src/lib/csv";

test("CSV cells escape spreadsheet formulas before quoting", () => {
  expect(csvCell("=HYPERLINK(\"https://unsafe.example\")")).toBe(
    "\"'=HYPERLINK(\"\"https://unsafe.example\"\")\"",
  );
  expect(csvCell("  +SUM(1,2)")).toBe("\"'  +SUM(1,2)\"");
  expect(csvCell("-10")).toBe("\"'-10\"");
  expect(csvCell("@operator")).toBe("\"'@operator\"");
  expect(csvCell("plain \"quoted\" text")).toBe("\"plain \"\"quoted\"\" text\"");
  expect(csvCell(true)).toBe("\"true\"");
  expect(csvCell(null)).toBe("\"\"");
});

test("CSV row helper applies the same escaping to every cell", () => {
  expect(
    csvRows([
      ["section", "value"],
      ["Owner", "=cmd"],
      ["Amount", 1250],
    ]),
  ).toBe("\"section\",\"value\"\n\"Owner\",\"'=cmd\"\n\"Amount\",\"1250\"");
});
