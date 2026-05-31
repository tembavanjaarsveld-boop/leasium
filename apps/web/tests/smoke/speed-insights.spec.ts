import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const packagePath = path.join(process.cwd(), "package.json");
const layoutPath = path.join(process.cwd(), "src/app/layout.tsx");

test("root layout wires Vercel Speed Insights for production web vitals", async () => {
  const [packageSource, layoutSource] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(layoutPath, "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource) as {
    dependencies?: Record<string, string>;
  };

  expect(packageJson.dependencies).toHaveProperty("@vercel/speed-insights");
  expect(layoutSource).toContain(
    'import { SpeedInsights } from "@vercel/speed-insights/next";',
  );
  expect(layoutSource).toContain("<SpeedInsights />");
});
