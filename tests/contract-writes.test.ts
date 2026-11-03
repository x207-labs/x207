// The reader of the contract source behind the CRUD matrix (tests/support/contract-writes.ts) drops test-only items and nothing else.
import { describe, expect, it } from "vitest";
import { analyseContract, stripTests } from "./support/contract-writes.ts";

describe("stripTests", () => {
  it("keeps the functions that come after a test-only function in the middle of the file", () => {
    const source = `
pub fn before(&mut self) { self.members.insert(1, 2); }
#[cfg(test)]
pub(crate) fn helper() { let x = { 1 }; }
pub fn after(&mut self) { self.positions.insert(1, 2); }
`;
    const out = stripTests(source);
    expect(out).toContain("fn before");
    expect(out).toContain("fn after");
    expect(out).not.toContain("helper");
  });

  it("drops a test module with nested braces and what only it contains, and keeps what follows it", () => {
    const source = `
fn real() { self.epochs.insert(1, 2); }
#[cfg(test)]
mod tests {
    fn nested() { if true { let _ = { 1 }; } }
    #[test]
    fn case() {}
}
fn later() { self.pairs.insert(1, 2); }
`;
    const out = stripTests(source);
    expect(out).toContain("fn real");
    expect(out).toContain("fn later");
    expect(out).not.toContain("nested");
    expect(out).not.toContain("mod tests");
  });

  it("drops a test-only use, which ends at its semicolon, and a test-only impl block", () => {
    const source = `
#[cfg(test)]
use crate::x::Y;
fn kept() {}
#[cfg(test)]
impl Foo { fn only_in_tests() {} }
fn kept_too() {}
`;
    const out = stripTests(source);
    expect(out).toContain("fn kept()");
    expect(out).toContain("fn kept_too()");
    expect(out).not.toContain("crate::x::Y");
    expect(out).not.toContain("only_in_tests");
  });

  it("does not touch a file without cfg(test), and removes comments", () => {
    expect(stripTests("fn a() {} // note\nfn b() {}")).toBe("fn a() {} \nfn b() {}");
  });
});

describe("analyseContract", () => {
  it("sees the F8 methods that follow a test-only helper in grant.rs", () => {
    const { writes } = analyseContract();
    for (const method of ["offer_grant", "accept_grant", "revoke_grant"]) expect([...writes.get(method)!], method).toContain("D11");
    expect([...writes.get("set_asset_class")!]).toEqual(["D10"]);
  });
});
