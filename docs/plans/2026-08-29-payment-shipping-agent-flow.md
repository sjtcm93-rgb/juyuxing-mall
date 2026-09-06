# Payment, Shipping, and Agent Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the local end-to-end flow reliably cover agent onboarding, referral attribution, payment settlement, and administrator shipping, with failures surfaced instead of silently accepted.

**Architecture:** Keep CloudBase functions as the source of truth for identity, order state, and commission eligibility. Extend the in-memory E2E harness to exercise the same cross-function lifecycle as production, then make narrowly scoped server and client fixes. Real payment and cloud deployment remain user-owned verification steps.

**Tech Stack:** WeChat Mini Program JavaScript, CloudBase cloud functions, `wx-server-sdk`, Node.js in-memory E2E harness.

---

### Task 1: Lock down the complete agent lifecycle in E2E

**Files:**
- Modify: `scripts/e2e-mock.js`

**Step 1: Write the failing agent onboarding test**

Add assertions for login, agent application, pending-list visibility, administrator approval, active agent status, and referral binding.

**Step 2: Run the focused E2E test and verify it fails**

Run: `node scripts/e2e-mock.js`

Expected: FAIL because the current test treats a never-approved user as an agent and does not enforce active-agent eligibility.

**Step 3: Add invalid-referrer assertions**

Verify self-referral and referrals to non-active users do not create an agent commission relationship.

**Step 4: Run the E2E test again**

Expected: New assertions fail before implementation.

### Task 2: Enforce active-agent attribution and consistent commissions

**Files:**
- Modify: `cloudfunctions/login/index.js`
- Modify: `cloudfunctions/order/index.js`
- Modify: `cloudfunctions/pay/index.js`
- Modify: `cloudfunctions/payNotify/index.js`
- Test: `scripts/e2e-mock.js`

**Step 1: Resolve a referrer only when it identifies a different, active agent**

Validate referral ownership server-side and ignore invalid or self referrals.

**Step 2: Resolve commission rate consistently**

Read `pay_config.default.commissionRate` first and fall back to `admin_config.admin.commissionRate`, then the 15% default, in every path.

**Step 3: Keep order commission fields aligned with the settlement record**

Update both `commission` and `commissionStatus` after mock or real settlement.

**Step 4: Run E2E**

Run: `node scripts/e2e-mock.js`

Expected: Agent onboarding, referral eligibility, payment, and commission assertions PASS.

### Task 3: Make shipping a guarded state transition

**Files:**
- Modify: `cloudfunctions/admin/index.js`
- Test: `scripts/e2e-mock.js`

**Step 1: Write failing shipping tests**

Assert that a paid order can move to shipped with logistics, while pending, missing, already shipped, and refunding orders cannot be shipped.

**Step 2: Run E2E and verify failure**

Run: `node scripts/e2e-mock.js`

Expected: FAIL because `shipOrder` currently updates without checking the current state or update count.

**Step 3: Implement the minimum guarded transition**

Load the order, require status `paid`, trim logistics inputs, update it, and require exactly one updated document.

**Step 4: Run E2E**

Expected: All shipping assertions PASS.

### Task 4: Remove stale agent UI state and harden payment UI completion

**Files:**
- Modify: `miniprogram/pages/user/user.js`
- Modify: `miniprogram/pages/agent-join/agent-join.js`
- Modify: `miniprogram/pages/order-detail/order-detail.js`
- Modify: `scripts/page-load-logic-test.js`

**Step 1: Write/update focused page tests**

Assert that agent status refreshes on page show after remote approval and payment submission state is cleared in every terminal branch.

**Step 2: Run focused tests and verify failure**

Run: `node scripts/page-load-logic-test.js`

Expected: FAIL under the current five-minute agent cache behavior.

**Step 3: Implement the minimum client fixes**

Refresh agent status from the server on each user-page show, clear stale cache after application, and clear `submitting` after mock/real payment success.

**Step 4: Run focused tests**

Expected: PASS.

### Task 5: Make payment callbacks retryable on processing failure

**Files:**
- Modify: `cloudfunctions/payNotify/index.js`
- Modify: `scripts/e2e-mock.js`
- Modify: `scripts/smoke-test.js`

**Step 1: Add a callback-failure test**

Force the order update to fail and assert the callback does not acknowledge success.

**Step 2: Implement retryable failure response**

Return non-zero `errcode` when durable order processing fails. Keep `errcode: 0` only for completed or idempotently completed notifications, matching CloudBase callback guidance.

**Step 3: Run focused and broad local checks**

Run: `node scripts/e2e-mock.js`

Run: `npm run smoke`

Run: `npm run lint:functions`

Expected: All PASS.

### Task 6: Compile and manually verify the simulator flow

**Files:**
- No source changes expected.

**Step 1: Reopen the existing WeChat DevTools project**

Active route: `pages/index/index`.

**Step 2: Compile and classify Console output**

Expected: No blocking compile or cloud-initialization errors. Compatibility warnings are reported separately.

**Step 3: Manually exercise mock payment, administrator shipping, and agent approval**

Expected: State transitions and page refreshes are visible in the simulator.

**Step 4: Hand off real-payment verification**

Real payment requires the user to log in, authorize CloudBase, deploy the changed functions, and use a phone. Do not trigger it automatically.

> No commits will be created during this run because the worktree already contains user-owned changes; all edits remain visible and unstaged for review.
