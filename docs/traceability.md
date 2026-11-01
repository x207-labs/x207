# Build traceability

Feature, code, tests and the demo step that shows it. Demo steps refer to [Run the sandbox demo](../README.md#run-the-sandbox-demo). Sandbox tests run with `npm run test:integration` (umbrella), `npm run test:sandbox` (`sdk`, `agents`) or `cargo test` (`contracts`). The GitHub CI has not run yet, so no row is backed by a CI result.

| Feature | Code | Tests | Demo step |
| --- | --- | --- | --- |
| F1 Onboarding and stake | `contracts/x207-circle/src/member.rs`, `contracts/x207-circle/src/stake.rs`, `sdk/packages/core/src/contract/onboard.ts`, `agents/onboarding/onboard.ts`, `frontend/src/pages/Onboarding.tsx` | `contracts/tests/ct019_onboarding.rs`, `sdk/packages/core/test/sandbox/onboard.sandbox.test.ts`, `agents/test/onboard.sandbox.test.ts`, `frontend/src/pages/Onboarding.test.tsx`, `tests/e2e.sandbox.test.ts` | F1 row (twelve transactions) |
| F2 Voucher payments | `contracts/x207-circle/src/voucher.rs`, `sdk/packages/scheme/`, `sdk/apps/facilitator/src/`, `agents/shared/x207.ts` | `contracts/tests/ct023_voucher_vectors.rs`, `sdk/apps/facilitator/test/roundtrip.test.ts`, `sdk/apps/facilitator/test/e2e.sandbox.test.ts`, `agents/test/ring.sandbox.test.ts`, `tests/f2.sandbox.test.ts` | F2 rows (402 entries, paid calls, registrations) |
| F3 Clearing and 207 report | `contracts/x207-circle/src/clearing.rs`, `contracts/x207-circle/src/commit.rs`, `solver/src/`, `backend/src/report207/`, `scripts/lib/keeper.mjs` | `contracts/tests/ct029_clearing_flow.rs`, `contracts/tests/ct030_clearing_property.rs`, `tests/f3.sandbox.test.ts`, `tests/keeper.sandbox.test.ts`, `tests/density.sandbox.test.ts` | F3 row (close, submit, commit, report) |
| F4 Residual settlement and claim | `contracts/x207-circle/src/settlement.rs`, `frontend/src/pages/Settlement.tsx`, `backend/src/settlement/` | `contracts/tests/ct035_claim.rs`, `contracts/tests/ct036_residual_flow.rs`, `tests/e2e.sandbox.test.ts`, `frontend/src/pages/Claim.test.tsx` | F4 row (settle, finalize, claim). Intents payment and cross-chain withdrawal are not in the demo. |
| F6 Default and stake cover | `contracts/x207-circle/src/settlement.rs` (`finalize_epoch`) | `contracts/tests/ct037_default_flow.rs`, `tests/e2e.sandbox.test.ts` (default case) | `DEMO_DEFAULT=scraper npm run demo:sandbox` |
| F7 Governance (`set_params`) | `contracts/x207-circle/src/params.rs`, `contracts/dao/`, `frontend/src/pages/Governance.tsx` | `contracts/tests/ct041_set_params.rs`, `contracts/dao/dao.test.mjs`, `sdk/packages/core/test/sandbox/lifecycle.sandbox.test.ts` (`params_updated`) | The demo calls `set_params` from the owner account; no DAO vote yet |
| P8 Indexer and read API | `backend/src/indexer/`, `backend/src/api/` | `backend/test/indexer/`, `backend/test/api/`, `tests/f3.sandbox.test.ts` | F3 row (report comes from the indexed D9) |

Gaps: the F7 DAO vote, the F4 Intents payment and withdrawal, and any mainnet run have no demo step. Mainnet hashes are not recorded (UM-040).
