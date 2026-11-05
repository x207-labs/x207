# Agents on any chain, cleared on NEAR (UM-155, draft)

**In progress, not deployed. EVM agents are not a working feature of x207 today.** One step has run: `join_evm` on testnet, transaction `GD92fvfjRMjmdRfDW3d8PqCft7GzPyiAGX6hLTjJ3E8A` on `x207-v014.testnet` (2026-11-05). Vouchers, `claim_evm`, exit and the demo have no hash yet.

Status: **a draft of the interface planned for contract v0.0.14. Only `join_evm` has run on a network (see above).** The contract, the SDK and the demo are being built (CT-104 to CT-107, SD-088 to SD-090, BE-093, FE-041); `x207-v013.testnet` does not have these methods. Every part that still needs a transaction hash is marked **no hash yet**, and this page must not be quoted as a result until those marks are gone. Source of the interface: `contracts/x207-circle/src/evm.rs` (work in progress) and the cross-check vectors `contracts/tests/fixtures/evm-eip712.json`.

## The goal

An agent that lives on an EVM chain keeps its `0x` key, its wallet and its USDC on EVM. It does not hold a NEAR key or a NEAR token. NEAR is the clearing layer behind it: the agent signs vouchers and a few actions with EIP-712, a relayer sends them to the circle contract, and the contract checks the signature.

## Where v0.0.13 stops

- A voucher is checked with `env::ed25519_verify` over the NEP-413 hash and the member's `pubkey_voucher`. `join` refuses any key that is not ed25519 (`ERR_BAD_PUBKEY`).
- A member is keyed by its NEAR `AccountId`, and the caller of `join` is the member itself. `register_*`, `commit_bundle` and the stake and settle calls can already be relayed; `join`, `claim`, `request_exit` and `withdraw_stake` need the member as the caller.
- The SDK has only an ed25519 signer.

## Design (draft)

1. **Identity.** An EVM member is its lowercase `0x` address of 42 characters, used as the `AccountId`. This is a valid NEAR eth-implicit account format. The account does not need to exist on chain, because the contract only uses it as a key.
2. **Signer record.** A side map `evm_signers` holds `{ address, sponsor, nonce }` per EVM member. The `Member` record is not migrated.
3. **EIP-712 signatures**, checked in the contract with `env::keccak256` and `env::ecrecover`. The recovered address must equal the member id. The domain is `{ name: "x207", version: "1" }` with no `chainId` and no `verifyingContract`, because the contract is not an EVM contract; replay between circles is stopped by the field `circle` in every message, which is the account id of the contract (for the new circle, `x207-v014.testnet`). A signature is the string `eip712:0x<130 hex>` (r, s, v; v is 27 or 28, or 0 or 1; a high `s` is refused).
4. **Voucher and bundle checks branch on the payer.** If the payer is in `evm_signers`, the signature must be `eip712:`; otherwise it stays `ed25519:`.
5. **Stake and settle** stay `ft_transfer_call` with `member_id = 0x…`. A relayer or NEAR Intents sends the token, so there is no new method for them.

### Signed types

| Type | Fields |
| --- | --- |
| `Voucher` | `circle string, payer string, payee string, epoch uint64, seq uint64, cumulativeAmount uint256, unit string, resource string` |
| `Bundle` | `circle string, message string, termsHash string` |
| `Action` | `circle string, member string, action string, epoch uint64, receiver string, termsHash string, nonce uint64, deadline uint64` |

`Action` is one type for every member action. How its fields are used:

| `action` | `epoch` | `receiver` | `termsHash` | `nonce` |
| --- | --- | --- | --- | --- |
| `join` | 0 | "" | the `terms_hash` argument | 0 |
| `claim` | the epoch claimed | the payout account | "" | the signer's nonce |
| `request_exit` | 0 | "" | "" | the signer's nonce |
| `withdraw_stake` | 0 | the payout account | "" | the signer's nonce |

`deadline` is in milliseconds and holds while `block_timestamp_ms <= deadline`. The nonce starts at 0 after `join_evm` and rises by one for each successful action.

### Methods (anyone may call; the signature is the gate)

| Method | Notes |
| --- | --- |
| `join_evm(address, terms_hash, deadline, signature)` | `#[payable]`, at least 0.35 NEAR. The caller is the `sponsor` and pays the storage deposit; on exit the refund goes back to the sponsor. |
| `claim_evm(member, epoch, receiver, nonce, deadline, signature)` | The payout goes to `receiver`, any NEAR account the agent signed. On mainnet this would be the NEAR Intents contract through `ft_transfer_call`, which credits the id `0x…`; the agent then withdraws to Base through Intents. On testnet it is an ordinary NEAR account. |
| `request_exit_evm(member, nonce, deadline, signature)` | |
| `withdraw_stake_evm(member, receiver, nonce, deadline, signature)` | The Intents contract is refused as a receiver. |

The argument `member` names whose action it is, so a relayer can send it. The view `evm_signer(account_id)` returns `{ address, sponsor, nonce }` or null. New errors: `ERR_BAD_EVM_SIG`, `ERR_EVM_NONCE`, `ERR_EVM_EXPIRED`, `ERR_NOT_EVM_MEMBER`, `ERR_BAD_EVM_ADDRESS`, `ERR_BAD_EVM_RECEIVER`; a failed check inside a bundle uses `ERR_BUNDLE_SIGNATURES`.

## SDK and relayer (draft)

- A `VoucherSigner` interface: `{ scheme: "ed25519" | "eip712"; id: string; sign(...) }`. `ed25519Signer(secretKey)` wraps the existing behaviour and `evmSigner(viemAccount)` uses `signTypedData`. The synchronous functions stay; async ones are added beside them.
- Off-chain verification uses `viem` `recoverTypedDataAddress`.
- MCP: the variable `X207_EVM_PRIVATE_KEY` as an alternative to an ed25519 key. Write tools stay opt-in.
- The facilitator gets `POST /evm/join`, `/evm/claim`, `/evm/exit` and `/evm/withdraw`, which pass the signature to the `*_evm` methods, with a rate limit per address.

## Money from and to EVM

| Route | State |
| --- | --- |
| Testnet: a relayer mints the mock USDT and stakes for the `0x…` member | **no hash yet** |
| Sandbox: the Intents path (`mt_on_transfer`, payout `intents`) in `near-sandbox`, as for KN-17 | **no result yet** |
| Mainnet: USDC from Base or Arbitrum enters through NEAR Intents or 1Click, then `ft_transfer_call` stakes with `member_id`; the payout leaves through `claim_evm` to Intents and then to Base | roadmap, **not tested**, and no mainnet transaction is planned |

## What it will not do

- No intent, grant, escrow or deal for an EVM member in the first version: those methods still need the member as the caller.
- The contract does not read any EVM chain. An ERC-8004 identity or reputation, if used, is read off chain by the backend at `join_evm` and enters `terms_hash` or the DAO's `admit_member` decision.
- The EIP-712 hash computed in Rust has to match `viem` byte for byte; cross-check vectors are required, and a security review (CT-107) comes before any deploy.

## Release and what proves it

The v0.0.14 contract is planned for a new circle, `x207-v014.testnet`. `x207-v013.testnet` is not upgraded and stays the proof that exists today (epoch 8, the keeper on boxd). The demo is done when one agent that holds only a `0x` key joins one epoch and reaches `finalized` on testnet. Until its transaction hashes are recorded here, nothing on this page is a claim.

| Step | Transaction |
| --- | --- |
| deploy `x207-v014.testnet` | **no hash yet** |
| `join_evm` | `GD92fvfjRMjmdRfDW3d8PqCft7GzPyiAGX6hLTjJ3E8A` (testnet, 2026-11-05; read back from RPC: the call and its `eip712:` signature are in the transaction, status `SuccessValue`) |
| stake by the relayer | **no hash yet** |
| EVM-signed vouchers registered | **no hash yet** |
| `claim_evm` after `finalize_epoch` | **no hash yet** |
