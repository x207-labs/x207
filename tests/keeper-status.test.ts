import { describe, expect, it } from "vitest";
import { hashIfOk, txFailure } from "../scripts/lib/keeper.mjs";

const ok = { status: { SuccessValue: "" }, transaction: { hash: "H1" }, receipts_outcome: [{ outcome: { status: { SuccessReceiptId: "r" } } }, { outcome: { status: { SuccessValue: "" } } }] };

describe("BE-106 keeper checks the outcome of the transaction it sent (A-BE-14)", () => {
  it("TC-BE-106-01 a successful transaction gives its hash", () => {
    expect(txFailure(ok)).toBeNull();
    expect(hashIfOk(ok, "commit_epoch")).toBe("H1");
  });

  it("TC-BE-106-02 a failed receipt (the contract ran out of gas or panicked) throws with method, hash and failure", () => {
    const failed = { ...ok, receipts_outcome: [{ outcome: { status: { SuccessReceiptId: "r" } } }, { outcome: { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Exceeded the prepaid gas." } } } } } } }] };
    expect(txFailure(failed)).toMatch(/^receipt .*Exceeded the prepaid gas/);
    expect(() => hashIfOk(failed, "commit_epoch")).toThrow(/commit_epoch failed \(tx H1\): receipt/);
  });

  it("TC-BE-106-03 a failed transaction status throws too", () => {
    const failed = { status: { Failure: { InvalidTxError: "NotEnoughBalance" } }, transaction: { hash: "H2" }, receipts_outcome: [] };
    expect(() => hashIfOk(failed, "finalize_epoch")).toThrow(/finalize_epoch failed \(tx H2\): transaction/);
  });
});
