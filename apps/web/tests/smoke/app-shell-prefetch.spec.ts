import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appShellPath = path.join(process.cwd(), "src/components/app-shell.tsx");

test("app shell disables automatic route prefetch for persistent navigation links", async () => {
  const source = await readFile(appShellPath, "utf8");

  expect(source).toContain("const shellLinkProps = { prefetch: false }");
  expect(source).toContain(
    '<Link\n        {...shellLinkProps}\n        href="/"',
  );
  expect(source).toContain(
    "<Link\n              {...shellLinkProps}\n              key={item.href}",
  );
  expect(source).toMatch(
    /mobileBottomNavItems\.map[\s\S]*<Link\s+\{\.\.\.shellLinkProps\}[\s\S]*href=\{item\.href\}/,
  );
  expect(source).toContain(
    '<Link\n              {...shellLinkProps}\n              href="/notifications"',
  );
  expect(source).toContain(
    "<Link\n                          {...shellLinkProps}\n                          href={action.href}",
  );
});
