import { createSanitizer, InMemoryStore } from "@hugents/core";
import { createManifest, InMemoryDraftRepository, ROOM_CODE_RULE } from "../src/index.js";

export const manifest = createManifest({
  projectId: "example-project",
  allowedTargetUrlPattern: "^https://qa-[a-z0-9-]+\\.example\\.test$",
  blockedTargets: ["prod", "www."],
  testAccountVariableNames: ["QA_ACCOUNT_A"],
  screens: [
    { id: "screen-one" },
    { id: "screen-two" },
    { id: "screen-hidden", hidden: true },
  ],
  forbiddenActions: ["delete account", "purchase", "sign out"],
});

export const NOW = "2026-10-07T10:00:00Z";
export const sanitizer = createSanitizer([ROOM_CODE_RULE]);

export function makeDeps() {
  return { store: new InMemoryStore(), drafts: new InMemoryDraftRepository(), sanitizer, manifest, now: () => NOW };
}

export const GOOD_SPEC = `import { test, expect } from "hugents-seed";

test("screen-one renders", async ({ page }) => {
  const save = page.getByRole("button", { name: "Save" });
  await expect(save).toBeVisible();
  await save.click();
  await expect(page.getByText("Saved")).toBeVisible();
});
`;

export const wrap = (body: string, imports = `import { test, expect } from "hugents-seed";`) =>
  `${imports}\n\ntest("t", async ({ page }) => {\n${body}\n});\n`;
