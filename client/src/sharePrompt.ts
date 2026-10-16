// The Share button's prompt: a fixed, data-free invitation. A friend pastes
// it into their own Muse, which builds them their OWN private dashboard
// from the public repo and connects THEIR OWN Plaid. It contains no account
// data and grants no access to this dashboard instance — keep it that way.
// The wording is pinned verbatim by tests/share-prompt.test.ts.
export const SHARE_PROMPT = `帮我装一个我自己的信用卡 Coupon Book dashboard。

代码仓库：https://github.com/yextyk/credit-card-coupon-book-dashboard

请先完整读一遍仓库里的 SETUP_FOR_MUSE.md，然后严格照它执行：
1. 用仓库代码在我的 Muse 里创建一个只属于我的私有 dashboard（不要用仓库里的虚构示例数据）；
2. 引导我连接我自己的 Plaid，把我名下所有卡的 statement credits 导进来，按月/季/半年/年显示当前周期已用和剩余；
3. 我的账户和交易数据只存在我自己的 app 里，不要写进代码或仓库。
装好之后告诉我未用总额和最近到期的 credit。`;
