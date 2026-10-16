import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHARE_PROMPT } from "../client/src/sharePrompt";

/**
 * The header Share button shows a fixed prompt a friend pastes into their
 * own Muse to build their OWN private dashboard from the public repo. The
 * text is user-mandated verbatim and must stay data-free: it points at the
 * repo and its SETUP_FOR_MUSE.md playbook, nothing about this instance.
 * Components are not rendered in this suite (see tests/README.md), so the
 * panel side is pinned by asserting App.tsx renders the constant itself —
 * not an inline copy that could drift from it.
 */

const appSource = readFileSync(join(import.meta.dir, "..", "client", "src", "App.tsx"), "utf8");

describe("SHARE_PROMPT", () => {
  test("points at the public repo and its setup playbook", () => {
    expect(SHARE_PROMPT).toContain("https://github.com/yextyk/credit-card-coupon-book-dashboard");
    expect(SHARE_PROMPT).toContain("SETUP_FOR_MUSE.md");
  });

  test("is exactly the mandated text", () => {
    const expected = [
      "帮我装一个我自己的信用卡 Coupon Book dashboard。",
      "",
      "代码仓库：https://github.com/yextyk/credit-card-coupon-book-dashboard",
      "",
      "请先完整读一遍仓库里的 SETUP_FOR_MUSE.md，然后严格照它执行：",
      "1. 用仓库代码在我的 Muse 里创建一个只属于我的私有 dashboard（不要用仓库里的虚构示例数据）；",
      "2. 引导我连接我自己的 Plaid，把我名下所有卡的 statement credits 导进来，按月/季/半年/年显示当前周期已用和剩余；",
      "3. 我的账户和交易数据只存在我自己的 app 里，不要写进代码或仓库。",
      "装好之后告诉我未用总额和最近到期的 credit。",
    ].join("\n");
    expect(SHARE_PROMPT).toBe(expected);
  });
});

describe("Share panel in App.tsx", () => {
  test("renders the SHARE_PROMPT constant in a Share panel", () => {
    expect(appSource).toContain('import { SHARE_PROMPT } from "./sharePrompt"');
    // Header button that opens the panel.
    expect(appSource).toContain('aria-label="Share this dashboard with a friend"');
    // The dismissible panel section, titled like the button.
    expect(appSource).toContain('aria-label="Share this dashboard"');
    expect(appSource).toContain("Share this dashboard</span>");
    // The prompt shown in a pre block, with the copy action.
    expect(appSource).toContain("{SHARE_PROMPT}</pre>");
    expect(appSource).toContain('aria-label="Copy share prompt to clipboard"');
    expect(appSource).toContain("Copy prompt");
  });

  test("the prompt text lives only in the constant, not inline in App.tsx", () => {
    // If the wording were pasted into the component it could drift from the
    // pinned constant; the distinctive lines must appear only via the import.
    expect(appSource).not.toContain("帮我装一个我自己的信用卡");
    expect(appSource).not.toContain("代码仓库：https://github.com");
  });
});
