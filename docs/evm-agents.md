# Agents on any chain, cleared on NEAR (UM-155)

**Runs on NEAR testnet (2026-11-05), not on mainnet.** One agent that holds only a `0x` key, new for this run and not a public test key (`0x58cd3d4987ad29a7bafdb8cdb90bfbe995e680b7`), took part in epoch 2 of the circle `x207-v014.testnet`: `join_evm`, admission by the DAO, stake by a relayer, EIP-712 vouchers, `close_epoch`, `commit_epoch` and `finalize_epoch` by the keeper, and `claim_evm` crediting the payout to the agent's `0x` id in the mock USDT token. The agent's `0x` key spends its own payout through its NEAR eth-implicit account (NEP-518, `rlp_execute`): any NEAR account can submit the transaction and pay the gas, only the `0x` key can authorize it. Proven on testnet (SD-095): 1 NEAR created the account (`GL8d5tvsneybDdui3ktz7HezeEXidHGM9GYcagfhwEN3`), then a `ft_transfer` of 30000 from the payout, signed by the `0x` key alone (chain id 398), went through `rlp_execute` (`J59PWbv4MHUz2o7DPJcNk1fUZGrnZc8xy7N39VTXwx6m`); the balance went from 80000 to 50000. Join and stake in this run still went through the x207 relayer; the full circle flow through `rlp_execute` is not tested. The record is [testnet-epochs/sd090-evm-agent-run.json](testnet-epochs/sd090-evm-agent-run.json); each hash below was read back from the testnet RPC on 2026-11-05 and succeeded.

**Limits of that run.** The agent did not hold a NEAR key, but it was not autonomous: a relayer account (`x207-demo-helper.testnet`) paid the 0.35 NEAR join deposit and the gas, funded the stake, registered the vouchers and paid the `storage_deposit` of the payout account. The token is the mock USDT. The money route from other chains was not exercised. The earlier transaction `GD92fvfjRMjmdRfDW3d8PqCft7GzPyiAGX6hLTjJ3E8A` (`join_evm`, 2026-11-05) used the public Hardhat test key #1 and is a technical proof only, not a demo agent.

**Built, deployed, run once on testnet:** settling from the stake (CT-108) is in contract 0.0.15, deployed as `x207-v015.testnet` (code hash `Hhs82yW5iJD2QH4juP6Ud5u7ApHGhcw8Zo5xCK1hxmoj` (since the redeploy of 2026-11-05; the SD-094 transactions ran on the earlier build, code hash `4eZhZF16ySGGv9ux3gzbxnH6znVxcHNQYivVFdfpuHz5`, sha256 `3632861b…`)); see [the section below](#settling-from-the-stake-opt-in-ct-108). One epoch was settled from a stake on testnet (SD-094, hashes in the section below). **In progress, not deployed:** a relayer fee, and every item of the roadmap below.

Source of the interface: `contracts/x207-circle/src/evm.rs` and the cross-check vectors `contracts/tests/fixtures/evm-eip712.json`. The design sections below describe the interface; where this page says "draft" it means the text was written before the run and has not been re-read line by line against the contract.

## The goal

An agent that lives on an EVM chain keeps its `0x` key, its wallet and its USDC on EVM. It does not hold a NEAR key or a NEAR token. NEAR is the clearing layer behind it: the agent signs vouchers and a few actions with EIP-712, a relayer sends them to the circle contract, and the contract checks the signature.

## Where v0.0.13 stops

- A voucher is checked with `env::ed25519_verify` over the NEP-413 hash and the member's `pubkey_voucher`. `join` refuses any key that is not ed25519 (`ERR_BAD_PUBKEY`).
- A member is keyed by its NEAR `AccountId`, and the caller of `join` is the member itself. `register_*`, `commit_bundle` and the stake and settle calls can already be relayed; `join`, `claim`, `request_exit`, `withdraw_stake` and `set_auto_settle` need the member as the caller.
- The SDK has only an ed25519 signer.

## Design (draft)

1. **Identity.** An EVM member is its lowercase `0x` address of 42 characters, used as the `AccountId`. This is a valid NEAR eth-implicit account format. The account does not need to exist on chain, because the contract only uses it as a key.
2. **Signer record.** A side map `evm_signers` holds `{ address, sponsor, nonce }` per EVM member. The `Member` record is not migrated.
3. **EIP-712 signatures**, checked in the contract with `env::keccak256` and `env::ecrecover`. The recovered address must equal the member id. The domain is `EIP712Domain(string name,string version,bytes32 salt)` = `{ name: "x207", version: "1", salt }` with `salt = keccak256("near:" + network + ":" + contract account id)`; `network` is `testnet` for `*.testnet`, else `mainnet`. It has no `chainId` and no `verifyingContract`, because the contract is not an EVM contract (the reasons are in `contracts/docs/evm-agents.md`). The salt binds a signature to the NEAR network and the contract account; replay between circles is also stopped by the field `circle` in every message, which is the account id of the contract (for the new circle, `x207-v014.testnet`). A signature is the string `eip712:0x<130 hex>` (r, s, v; v is 27 or 28, or 0 or 1; a high `s` is refused).
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
| `auto_settle` (on) / `auto_settle_off` (off) | 0 | "" | "" | the signer's nonce |

`deadline` is in milliseconds and holds while `block_timestamp_ms <= deadline`. The nonce starts at 0 after `join_evm` and rises by one for each successful action.

**Short deadlines; re-sign if not sent.** The contract has no upper bound on `deadline`, and a signed action stays valid until its deadline passes or its nonce is used. A signature that a relayer holds (or that leaks from a log) is therefore as good as the deadline is long. Sign with a short deadline and sign again if the action was not sent in time. The SDK does this by default: `signer.signAction(input)` without a `deadline` signs `now + 10 minutes` (`EVM_DEFAULT_DEADLINE_TTL_MS`), and `signAction(input, { maxTtlMs })` refuses a longer one. Example: a member signs `auto_settle_off` to stop paying from its stake. A relayer that holds it for a month and sends it late still switches auto-settle off at that moment, which the member may no longer want. With a 10-minute deadline the held message is dead after 10 minutes; the member signs a new one with the same nonce if it still wants the change.

Salt note: the domain salt takes its network word from the account suffix (`.testnet` gives `testnet`, any other name gives `mainnet`), so on mainnet and on a sandbox or fork the account name is the only separator (CT-113 R3). A proposal for an init parameter that names the network is on the roadmap (`docs/metrics-and-roadmap.md`).

### Methods (anyone may call; the signature is the gate)

| Method | Notes |
| --- | --- |
| `join_evm(address, terms_hash, deadline, signature)` | `#[payable]`, at least 0.35 NEAR. The caller is the `sponsor` and pays the storage deposit; on exit the refund goes back to the sponsor. |
| `claim_evm(member, epoch, receiver, nonce, deadline, signature)` | The payout goes to `receiver`, any NEAR account the agent signed. On mainnet this would be the NEAR Intents contract through `ft_transfer_call`, which credits the id `0x…`; the agent then withdraws to Base through Intents. On testnet it is an ordinary NEAR account. |
| `request_exit_evm(member, nonce, deadline, signature)` | |
| `withdraw_stake_evm(member, receiver, nonce, deadline, signature)` | The Intents contract is refused as a receiver. |
| `set_auto_settle_evm(member, enabled, nonce, deadline, signature)` | Turns settling from the stake on or off for an EVM member; see [the section below](#settling-from-the-stake-opt-in-ct-108). |

The argument `member` names whose action it is, so a relayer can send it. The view `evm_signer(account_id)` returns `{ address, sponsor, nonce }` or null. New errors: `ERR_BAD_EVM_SIG`, `ERR_EVM_NONCE`, `ERR_EVM_EXPIRED`, `ERR_NOT_EVM_MEMBER`, `ERR_BAD_EVM_ADDRESS`, `ERR_BAD_EVM_RECEIVER`; a failed check inside a bundle uses `ERR_BUNDLE_SIGNATURES`.

## SDK and relayer (draft)

- A `VoucherSigner` interface: `{ scheme: "ed25519" | "eip712"; id: string; sign(...) }`. `ed25519Signer(secretKey)` wraps the existing behaviour and `evmSigner(viemAccount)` uses `signTypedData`. The synchronous functions stay; async ones are added beside them.
- Off-chain verification uses `viem` `recoverTypedDataAddress`.
- MCP: the variable `X207_EVM_PRIVATE_KEY` as an alternative to an ed25519 key. Write tools stay opt-in.
- The facilitator gets `POST /evm/join`, `/evm/claim`, `/evm/exit` and `/evm/withdraw`, which pass the signature to the `*_evm` methods, with a rate limit per address.

## Settling from the stake (opt-in, CT-108)

Status: **in contract 0.0.15, on `x207-v015.testnet`; checked by unit tests, a security review and one run on testnet (SD-094).** The run, in epoch 2 of `x207-v015.testnet` with the mock USDT (record: [testnet-epochs/sd094-auto-settle-run.json](testnet-epochs/sd094-auto-settle-run.json); each hash was read back from the testnet RPC on 2026-11-05 and succeeded):

| Step | Transaction |
| --- | --- |
| `set_auto_settle_evm` (the EVM agent `0xcdaba48462aea97aff54fd15421a5dc8a589b845` opts in; the relayer submits) | `AT1BuQFscV2yX2ixRYFTxytbXZY1uSYJBYfEoPw1CMeT` |
| `register_cumulative`, one voucher of 20000 to the seller | `5KpqyYs8X1GTxt6hPohy4QXZBn6RcJ6vk99D4JDxJs8A` |
| `finalize_epoch`: the agent did not pay; 20000 taken from its stake (40000000 to 39980000), event `auto_settled`, status `active`, position `paid` | `FoH49TfgQuYR2iG5HjoUEjXercyDynh7pKANKAEzLVek` |
| `claim` by the seller (event `residual_claimed` 20000) | `AoMvsPrS5A2B3aw9etj3hJ2BTPr2aeBpX967t3MGvr91` |
| Variant: the same agent switches auto-settle on through its own eth-implicit account, `rlp_execute` (event `auto_settle_set`, `enabled: true`). The `0x` key signed an EIP-1559 transaction (chain id 398); an ordinary NEAR account, `x207-demo-helper.testnet`, submitted it and paid the gas | `6zkgYgxW219YB3i3aE5UNhTRzKg1rBgxBVvc2UvT6N6y` |

The run is one debtor and 20000 of mock USDT; the relayer paid the gas and the stake of the agent. It ran on the build with code hash `4eZhZF16ySGGv9ux3gzbxnH6znVxcHNQYivVFdfpuHz5`; the contract now deployed is the reproducible build `Hhs82yW5…` of the same source (CT-111). It shows that the path works once, not how it behaves with many debtors. Source: [contracts/docs/evm-agents.md](https://github.com/x207-labs/contracts/blob/main/docs/evm-agents.md) and the [security review](https://github.com/x207-labs/contracts/blob/main/docs/security-review-auto-settle.md).

**What it is.** A member that opts in and does not pay its `due` in the payment window has the `due` taken from its own stake by `finalize_epoch`. The member stays `active`: no `member_defaulted`, no suspension, no limit set to 0. The position goes from `due` to `paid`, and creditors claim in full unless another debtor of that epoch defaults with a shortfall (the pool is then shared pro rata). Settling from the stake does not raise `settled_history`; only a cash settlement does. A default does not reset `settled_history` either: it takes the stake, sets the limit to 0 and suspends the member. It is off by default.

| Item | What it does |
| --- | --- |
| `set_auto_settle(enabled)` | A NEAR member turns it on or off. It needs 1 yocto, so a function-call access key cannot switch it off. Errors: `ERR_NOT_MEMBER`, `ERR_MEMBER_EXITED`, and the 1 yocto check of NEAR |
| `set_auto_settle_evm(member, enabled, nonce, deadline, signature)` | The same for an EVM member; anyone relays it, the signature of the `0x` key is the gate. The signed action is `auto_settle` (on) or `auto_settle_off` (off), so a signed "on" cannot be replayed as "off". Errors: `ERR_NOT_MEMBER`, `ERR_MEMBER_EXITED`, `ERR_NOT_EVM_MEMBER`, `ERR_EVM_NONCE`, `ERR_EVM_EXPIRED`, `ERR_BAD_EVM_SIG` |
| `is_auto_settle(account_id)` | View: is the flag on |
| Events | `auto_settle_set { account_id, enabled }`; `auto_settled { epoch, account_id, due, stake, status: "active", position_status: "paid", outstanding_debt }`, written by `finalize_epoch` |

**The rule at `finalize_epoch`.** For a debtor whose `due` is unpaid, the contract pays from the stake only if all of these hold: the flag is on; the member is `active`; its free stake (stake minus a locked bond) is at least the `due`; and the flag was set at or before `committed_at` of that epoch. If one fails, nothing partial happens and the usual default path runs unchanged. The stake shrinks by the `due`, so the next credit limit follows it.

**Why the time rule.** Without it a member could miss its `due`, wait until the payment window is closed, and only then opt in, which would turn a default into a stake-paid settlement and remove the penalty (finding M1 of the security review, fixed in 0.0.15). An opt-in after the commit counts from the next epoch. The opt-in is a toggle that can be set at any time, not tied to `join_evm`.

**Limits.**
- It moves the `due` from the member's own stake. It does not create credit and it does not save cash for the creditors; they are paid either way (from the debtor's cash or from its stake).
- A member whose free stake is below the `due` still defaults, as before.
- A member that was suspended and reactivated, and that no call has touched yet, can still be defaulted as before (finding L1, accepted and documented).
- A frozen member is still auto-settled. A `pending` or `suspended` member may set the flag, but it has no effect until the member is `active`.
- When the event log is full, `auto_settled` can be left out; `list_positions` then shows the position as `paid`, and a note line says how many events were left out. On chain, a stake-paid `paid` and a cash `paid` look the same without the event.
- Gas measured in a unit test: `finalize_epoch` with 64 members, 63 of them auto-settled, about 77 Tgas. That is a test, not a testnet run.

## Money from and to EVM

| Route | State |
| --- | --- |
| Testnet: a relayer stakes the mock USDT for the `0x…` member | ran: `95vup35nJTftkFjMKBcq4hxipGcHfSjnV6ffUdHXEAtP` |
| Sandbox: the Intents path (`mt_on_transfer`, payout `intents`) in `near-sandbox`, as for KN-17 | **no result yet** |
| Mainnet: USDC from Base or Arbitrum enters through NEAR Intents or 1Click, then `ft_transfer_call` stakes with `member_id`; the payout leaves through `claim_evm` to Intents and then to Base | roadmap, **not tested**, and no mainnet transaction is planned |

## Funding from other chains

**This route is mainnet and has not been tested. The testnet demo proves only the EIP-712 signatures and the netting; no money crosses a chain in it.** What is planned, from the design note:

1. **In.** USDC or USDT on an EVM chain enters through [NEAR Intents 1Click](https://docs.near-intents.org/), or through HOT Bridge with Omni Balance ([HEX guide](https://hot-labs.gitbook.io/hex/)), which takes USDT from more than twenty networks and credits `intents.near` with the Omni address in the `msg` field. The token then reaches the circle as an `ft_transfer_call` that stakes with `member_id = 0x…`.
2. **Out.** `claim_evm` names the Intents contract as `receiver` (an `ft_transfer_call` that credits the id `0x…` there); the agent then withdraws to its home chain through Intents. `withdraw_stake_evm` refuses the Intents contract as a receiver.
3. **What has run so far on this route:** a 1Click quote for a withdrawal of 5 credit to USDC on Base, with `dry: true` on 2026-11-04 (4.989148 USDC out, no deposit address, no funds moved; [what-has-run.md](what-has-run.md), [recorded answer](https://github.com/x207-labs/backend/blob/main/docs/reference.md#live-quote-of-1click-be-090)). Nothing for the deposit direction, and no quote for an `0x…` member.

Open points we have not checked: the fees and minimums of the route (a small payment can lose a large share of its value, see [gas-epoch8-vs-transfers.md](gas-epoch8-vs-transfers.md)), whether a given token and chain pair is supported on the day, and the time a deposit takes. No mainnet transaction is planned without the owner's approval.

## Who pays the relayer (draft; no fee is built)

An EVM agent holds no NEAR token, so someone else sends its transactions and pays their gas. In the planned design:

- **Join.** The caller of `join_evm` is the `sponsor` and pays the storage deposit, at least 0.35 NEAR. On exit the refund of that deposit goes back to the sponsor, not to the agent.
- **Gas.** The relayer pays the gas of every `*_evm` call (`claim_evm`, `request_exit_evm`, `withdraw_stake_evm`, `set_auto_settle_evm`) and of the relayed voucher registrations. Today that relayer is the team's account on testnet.
- **Fee.** There is none. The clearing fee and the solver fee are 0 since epoch 48 ([governance-live.md](governance-live.md)), and the contract has no relayer fee, so a relayer earns nothing from relaying. A third party has no reason to run one until a fee exists.
- **Sybil limit.** Anyone can create `0x…` addresses for free, and each one costs the sponsor 0.35 NEAR to join, so a sponsor that pays for strangers can be drained. The tool the circle has is its admission mode: `x207-v013.testnet` has `admission` open; with admission set to DAO, a new member needs a DAO vote through `admit_member`. A stake is also required to get any limit, and a member without a stake can owe nothing.
- **Open questions:** whether a relayer may take a fee from the agent's payout, and whether the sponsor deposit should be charged to the agent's stake. Neither is decided.

## Cross-chain roadmap (not built)

Every item below is **not built and not tested**. They are the routes we know of that would make an EVM agent need the team's relayer less, and none is needed for the testnet demo.

| Item | What it would do | State |
| --- | --- | --- |
| Funding through NEAR Intents with ERC-191 signatures | The agent funds and withdraws its Intents balance by signing on its home chain, with `ft_withdraw` and a `msg` that names the circle | not built |
| A circle in USDC | A circle whose stake token is USDC instead of the mock USDT | not built |
| Reputation export | Export a member's settlement history as an ERC-8004 reputation through Chain Signatures | not built |
| Solana agents | A signature scheme for Solana keys (`raw_ed25519`) next to ed25519 and EIP-712 | not built |
| On-chain actions by an EVM agent through NEP-518 | The eth-implicit account route (`rlp_execute`): spending the payout is proven on testnet (SD-095, hashes in the table above); calling the circle contract itself through it ran once, for `set_auto_settle` (SD-094, the variant row of the table in the section on settling from the stake); join, stake and vouchers through it are not tested. The key authorizes; any NEAR account can submit the transaction and pays the gas, and x207 has no relayer method for it | partly proven |
| Settlement from the stake for EVM members | An opt-in settle from the stake, so that an agent that cannot send a NEAR transaction is not suspended when it misses the payment window | built in 0.0.15 and run once on testnet (see above) |

## What it will not do

- No intent, grant, escrow or deal for an EVM member in the first version: those methods still need the member as the caller.
- The contract does not read any EVM chain. An ERC-8004 identity or reputation, if used, is read off chain by the backend at `join_evm` and enters `terms_hash` or the DAO's `admit_member` decision.
- The EIP-712 hash computed in Rust has to match `viem` byte for byte; cross-check vectors are required, and a security review (CT-107) comes before any deploy.

## Release and what proves it

The v0.0.14 contract runs as a new circle, `x207-v014.testnet`. `x207-v013.testnet` is not upgraded and stays the proof of epoch 8 (the keeper on boxd). The demo is done when one agent that holds only a `0x` key joins one epoch and reaches `finalized` on testnet; that was met on 2026-11-05 with the run below. Net of epoch 2: the agent owed the seller 20000, the seller owed the agent 100000, the seller paid 80000 (mock USDT units) and the agent claimed 80000.

| Step | Transaction (testnet) |
| --- | --- |
| deploy `x207-v014.testnet` | not recorded on this page |
| seller `join` | `FsgrVv8PRJiAHjBkRb5DBZg1ZavXRxxyzyxTZdpouDE9` |
| DAO proposal 7 to admit the seller: add, votes | `7uCBXS2Kv42N7qDaJjiYoBZMkiZB1RM9apYQnEr61CUN`, `DHqJhokxMhWATEhwqERAxrZu7nKzbgWhH959DeEGmoFt`, `HAE69fM9uvs675w28SxhnXYShWc1YP7c2VF1KeGRZ15i` |
| `join_evm` (new key) | `E5dQ4Wn4TZyFUXheKvS1CS7whUaLHJ8sXp8hZ2zQJN3c` |
| DAO proposal 8 to admit the agent: add, votes | `3WTfEiLcMuay7AeG7NPoBY9ynsMM6AS5haqkG9dAQz93`, `4JFYZdxiYoepXfQKqBPuj9T7tUAoEAm3JCK5hUbn8uSZ`, `22BcSPvtgHzTH89AP7dUvX4rk7C81zL2CcELc2Rz6bUd` |
| stake of the agent by the relayer | `95vup35nJTftkFjMKBcq4hxipGcHfSjnV6ffUdHXEAtP` |
| stake of the seller | `7rQCsQfJBCrB7D2vPKeTwQh58t4UjAjSX9ggssTA6ZeK` |
| voucher agent to seller, 20000, EIP-712 | `H19ZgnLYAmvsFio1R1dqp9941LoJQ9FR7TzMdCrArZbv` |
| voucher seller to agent, 100000, ed25519 | `7LkqrQWhR32eX82477ojQ35ZJjnsGcHg3x82R4RkSUqJ` |
| `close_epoch`, `commit_epoch`, `finalize_epoch` by the keeper | `Aztg7FxNLThjGkRMEEMUGrzPaPMY4NqA6FEPEGmTRMHU`, `CybAemjMvYY9GUEeCwb41HFZizpHbbkng6KKEdGR3biT`, `9ZnkmQkdz5zu2GvxJU49MayX2HoGmtdGwTCsdBfea85i` |
| seller settles 80000 | `6nFHqFmnrtJNuHrvHXQsD5Qd5bmfV9Xo6W79e8TY8QwK` |
| `storage_deposit` of the payout account by the relayer | `DEdRKLoDZbgbscprTkhP5D8S14xfNUhVQ8DdATunshfz` |
| `claim_evm`, payout credited to the agent's `0x` id in the token | `ERoUbiz3U2MgCkWR8YDuhzria7j8RvwYE8NCvvpziQMm` |
| 1 NEAR sent to the agent's `0x` id, which creates its eth-implicit account (SD-095) | `GL8d5tvsneybDdui3ktz7HezeEXidHGM9GYcagfhwEN3` |
| `rlp_execute`: `ft_transfer` of 30000 from the payout, signed by the `0x` key (SD-095) | `J59PWbv4MHUz2o7DPJcNk1fUZGrnZc8xy7N39VTXwx6m` |

The run was made in two parts because an RPC outage at 05:45 UTC stopped the first; the second resumed at epoch 2. The paid call of the first part was a 200 answer with a cumulative amount of 20000.
