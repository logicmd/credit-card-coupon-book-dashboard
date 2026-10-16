import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REFER_PROMPT } from "../client/src/referPrompt";

/**
 * The header Refer button shows a fixed prompt a friend pastes into their
 * own Muse to build their OWN private dashboard from the public repo. The
 * text is user-mandated verbatim, English-only, and deliberately carries no
 * setup steps — it only points at the repo and its SETUP_FOR_MUSE.md
 * playbook, which does the guiding. It must stay data-free: nothing about
 * this instance. Components are not rendered in this suite (see
 * tests/README.md), so the panel side is pinned by asserting App.tsx renders
 * the constant itself — not an inline copy that could drift from it.
 */

const appSource = readFileSync(join(import.meta.dir, "..", "client", "src", "App.tsx"), "utf8");

describe("REFER_PROMPT", () => {
  test("points at the public repo and its setup playbook", () => {
    expect(REFER_PROMPT).toContain("https://github.com/yextyk/credit-card-coupon-book-dashboard");
    expect(REFER_PROMPT).toContain("SETUP_FOR_MUSE.md");
  });

  test("is exactly the mandated text", () => {
    expect(REFER_PROMPT).toBe(
      "Muse, set up my own Credit Card Coupon Book dashboard from this repo: https://github.com/yextyk/credit-card-coupon-book-dashboard — read SETUP_FOR_MUSE.md and follow it to build the app and connect my own accounts.",
    );
  });
});

describe("Refer panel in App.tsx", () => {
  test("renders the REFER_PROMPT constant in a Refer panel", () => {
    expect(appSource).toContain('import { REFER_PROMPT } from "./referPrompt"');
    // Header button that opens the panel.
    expect(appSource).toContain('aria-label="Refer this dashboard to a friend"');
    // The dismissible panel section, titled like the button.
    expect(appSource).toContain('aria-label="Refer this dashboard"');
    expect(appSource).toContain("Refer this dashboard</span>");
    // The prompt shown in a pre block, with the copy action.
    expect(appSource).toContain("{REFER_PROMPT}</pre>");
    expect(appSource).toContain('aria-label="Copy refer prompt to clipboard"');
    expect(appSource).toContain("Copy prompt");
  });

  test("the prompt text lives only in the constant, not inline in App.tsx", () => {
    // If the wording were pasted into the component it could drift from the
    // pinned constant; the distinctive line must appear only via the import.
    expect(appSource).not.toContain("Muse, set up my own Credit Card Coupon Book dashboard from this repo:");
  });
});
