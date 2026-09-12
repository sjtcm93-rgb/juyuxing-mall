# Refund Consistency Implementation Plan

> Execute task-by-task in the existing dirty workspace; preserve unrelated changes. No cloud writes, deployments or real funds tests.

**Goal:** Never post a refund, release inventory or reverse commission before channel-confirmed success; restore a coherent ABC acceptance baseline.

**Architecture:** Admin approval queues a fixed refund identity transactionally. An authorized Mini Program owner/finance operator submits and reconciles the queue; accepted or ambiguous requests remain unsettled. Confirmed success applies refund/order/inventory/ledger effects in one transaction. Retire the unsafe legacy HTTP write path.

**Tech Stack:** CloudBase wx-server-sdk, Node.js offline test doubles, Vue admin, WeChat Mini Program.

## 1. Refund regression tests

- Create `scripts/refund-consistency-test.js` with isolated database and payment doubles.
- Demonstrate current failure for manual fallback posting money, acceptance versus completion, unauthorized callers and replay.
- Run `node scripts/refund-consistency-test.js`; expect failures before implementation.

## 2. Refund backend

- Modify `cloudfunctions/refund-processor/index.js`: trusted identity authorization; leased claim; query before submission; persist uncertainty; reconcile success; manual review without effects; aggregate-only results.
- Extract identical deployable refund-effects helpers into admin and processor packages; enforce transactions and atomic refund completion.
- Modify `cloudfunctions/admin/index.js`: transactional approval and status filters; queue does not claim money returned.
- Disable writes/reads in obsolete `cloudfunctions/admin-refund-http/index.js`; retain source for recovery but return retired error before execution.
- Run the focused test after each change. Test timeout, mismatch, unknown status, duplicate calls, rollback and return inventory choice.

## 3. Operator UX

- Remove consumer-start refund side effect from `miniprogram/app.js`.
- Add explicit owner/finance queue execution and status feedback to `miniprogram/subpackages/admin-auth/confirm/confirm.*`; reuse QR login entry.
- Update admin refund labels, pending filters, persisted errors and operator instructions in `admin-web/app.js` and `index.html`.
- Keep web refund query read-only. No unverified manual-success button.

## 4. Rules and launch gates

- Keep the newly selected 33% default while test explicit configured rates separately; do not rewrite historical commissions.
- Restore invitation-only activation and no distributor entry on consumer account page per approved ABC design.
- Disable mock-pay authorization in the local deployment template; do not mutate cloud configuration.
- Update deployment notes with required manual reconciliation of legacy false-success refunds, package list and actual verification limits.

## 5. Verify

- Run `npm run smoke`, `node scripts/e2e-mock.js`, `node scripts/refund-diagnostics-test.js`, `node scripts/refund-consistency-test.js`, `node scripts/page-load-logic-test.js`, `node scripts/admin-qr-auth-test.js`, `node scripts/release-gap-test.js`, `npm run lint:functions`.
- Inspect diff for unintended edits and syntax-check helpers.
- No automatic commit of user-owned mixed changes. Report local completion separately from cloud deployment and genuine payment acceptance.
