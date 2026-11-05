# Solana agents (SD-098)

A Solana keypair is an ed25519 keypair, and so are NEAR access keys and x207 voucher keys. The 32-byte public key of a Solana agent is therefore three things at once, and no contract change is needed:

| What | Form |
| --- | --- |
| Solana address | base58 of the 32 bytes |
| NEAR implicit account (the member id in the circle) | the same 32 bytes as 64 lower-case hex characters; the account is created by a first transfer |
| `pubkey_voucher` given to `join` | `ed25519:<base58 of the same 32 bytes>` |

The Solana agent is a plain NEAR member: it signs `join`, `ft_transfer_call` (stake, settle) and `claim` as the implicit account with its own key, and signs vouchers with the NEP-413 payload of any other member (ed25519 over `sha256`). The helper that derives these forms from a `solana-keygen` file is `sdk/examples/solana-agent/src/agent.ts`; offline tests are in `sdk/examples/solana-agent/test/solana-agent.test.ts` (TC-SD-098-01..04).

## The run on testnet

**Testnet only (2026-11-05), not mainnet.** Epoch 20 of `x207-v015.testnet`, mock USDT, real clock. Record: [testnet-epochs/sd098-solana-agent-run.json](testnet-epochs/sd098-solana-agent-run.json) (hashes and account names only). Run by `sdk/examples/solana-agent/test/solana-agent.mixed-epoch.testnet.live.test.ts`; passed in 1595 s.

| Step | Detail |
| --- | --- |
| Solana agent | new keypair for this run, kept in a file outside every repository. Solana address `7iN9bPDScwoE38x6PRa3svPbx5QFeg3d4zbRHAgCb6kn`; NEAR account `63bed8d66b6bf410807fcc2a53fe9e822614c3e4ab4e91b14853c80a1fbe283f` |
| Funding | 1 NEAR plain transfer to the implicit account (`DhqmnRkhP1m1wg6qWcgNdCqorSqDCz7JLiRrSrV6vdFA`) |
| `join`, admission by the DAO council, stake | `4fL9QXeRHK3xJ3szTCDFme6cXMKMKZWnUL354kZz5dhN`; proposal `GBFB2G7jwncSTT45Q4qrPZNW5cYVmTNMhrNvYqMs5NeT`, votes `6dgbfvqGFr9xgm8qbBiKFrU33563rjAw6ftf5PXw5ULD` and `EtEcPZqCzRX3ydQ4fUntffWSPQPAnSkwskC2tBw3sCGs`; stake 40 mock USDT (`2vJfxwqwE87u1GDNuQ9r23sjC7SfPRY1pHL4CagZ6uVU` after a mint of 100, `2J9v7JMAe8DeMuRx3XefuoDA1duyoEv3tBe7JcCUBN12`) |
| Voucher EVM agent `0xcdaba484…b845` to Solana agent, 20000, EIP-712 | `4cyfGwuAQdSJPUjj6xN6jSL3PDRpwQsxWsr1c1S29XGR` |
| Voucher Solana agent to EVM agent, 50000, ed25519 | `8169xNQb9wUgFoTmVGR3xrj9XNnT9wYLN2dy5CMUg877` |
| After `commit_epoch` | obligation 70000; net positions: Solana agent debtor 30000, EVM agent creditor 30000 (the two vouchers offset each other: 50000 − 20000) |
| Solana agent pays its residual (`settle`, 30000) | `GrZpuZ5o2qYdvU9P6QTy1qHXE8xooFFYsmm5hmUo8Gee`; position `paid` |
| `finalize_epoch` | by the keeper (journal of `x207-keeper-v015`) |
| EVM agent `claim_evm`, 30000 to `x207-demo-helper.testnet`, sent by the relayer | `DrbrNnD8eAintZHkxwCC9rLRanBgF927gi57mLQCyyrp`; position `claimed` |

Notes. `total_cleared` of the epoch stayed 0: with only two members the debts cancel in the net positions (the contract nets each member's vouchers), not in a cleared cycle of the solver. The Solana agent was not autonomous: the x207 helper account paid its 1 NEAR of gas and deposit and minted its mock USDT, and the EVM agent's claim went through the relayer, as in SD-094. The Solana key was used for NEAR transactions (as the implicit account's access key) and for vouchers; no Solana transaction was sent, so the Solana side of the agent is only its address here.

## Risk: one key on two chains

The same key now authorizes things on Solana and on NEAR. What follows is how the messages are kept apart, and what is not covered.

**What keeps the messages apart (domain separation).**

- A Solana transaction signature is ed25519 over the serialized *message* of the transaction: a legacy message starts with a three-byte header and carries at least one account key, a blockhash and an instruction (well over 100 bytes), a versioned message starts with the byte `0x80`.
- An x207 voucher signature is ed25519 over exactly 32 bytes: `sha256` of a NEP-413 payload that starts with the four bytes of the tag `2^31 + 413`, then the canonical voucher JSON (circle, payer, payee, epoch, seq, cumulativeAmount, unit, resource), a nonce `sha256("x207:" + payer + ":" + payee + ":" + epoch + ":" + seq)` and the circle account as recipient.
- A Solana message cannot be 32 bytes long, so no signature over a valid Solana transaction is also a signature over a voucher hash; the reverse fails for the same reason (a 32-byte hash is not a valid Solana message). TC-SD-098-04 checks that a signature over a Solana transfer message does not verify as a voucher signature, and that the preimages differ.
- NEAR transactions also sign a 32-byte hash (`sha256` of the borsh transaction). The NEP-413 tag keeps a voucher hash from being a transaction hash: a transaction starts with the signer account id as a length-prefixed string, the tag is a four-byte value above `2^31`, which would have to be a signer id of more than two billion bytes.
- A voucher also binds the circle (message and recipient), the two parties, the epoch and the sequence, so it cannot be replayed in another circle or epoch.

**What is not separated.**

1. **One compromise loses everything.** The key is the Solana wallet, the full-access key of the NEAR implicit account (stake, balance, payouts) and the voucher key (obligations up to the member's limit). Anyone with the key can move the SOL, drain the NEAR account and sign vouchers.
2. **Blind signing.** A Solana wallet that signs an opaque 32-byte message (`signMessage`) for a web page signs it without knowing it is a voucher hash for a different chain. A voucher agent must hold its key itself, in software of its own, and never expose `signMessage` for arbitrary bytes to a page.
3. **Use a dedicated keypair.** Do not use the key of a wallet that holds funds on Solana as an x207 agent. Make a keypair for the agent (as this run did) and fund the Solana side with only what it needs.
4. **Separating the roles (idea, not tested).** The implicit account starts with its derived key as a full-access key. NEAR lets the account add another key and delete the derived one, which would leave the Solana-derived key only as a voucher key. We did not run this, and the stake and payout flows were not checked in that configuration.
5. **Hardware wallets and Solana programs** (a Solana program that derives its own key, a hardware wallet that refuses raw 32-byte messages) were not tested; the run used a plain keypair file.
