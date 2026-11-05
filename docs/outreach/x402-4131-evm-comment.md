# Draft comment for x402-foundation/x402#4131: EVM keys sign the voucher (UM-167)

Status: **posted on 2026-11-05** as [issuecomment-6653355933](https://github.com/x402-foundation/x402/issues/4131#issuecomment-6653355933), with the text below. Post it only if the issue is still open and the last comment does not already answer the point. Before posting, read the issue again and drop any sentence that repeats it.

Target: [x402-foundation/x402#4131](https://github.com/x402-foundation/x402/issues/4131), the proposal for a multi-party binding of the `batch-settlement` scheme on NEAR. The facts below are in [evm-agents.md](../evm-agents.md); the hashes are in [testnet-epochs/sd090-evm-agent-run.json](../testnet-epochs/sd090-evm-agent-run.json), checked by `npm run check:claims`.

## Comment (about 150 words)

```text
Update on the NEAR binding: the voucher can be signed by an EVM key, so an agent that only holds a 0x key (the usual x402 client on Base) can take part without creating a NEAR key first.

On NEAR testnet (circle x207-v014.testnet, mock USDT, no mainnet transaction) one new 0x key joined the circle (join_evm), signed an EIP-712 voucher, was netted with the other members' vouchers in one epoch, and received its payout. The contract checks the signature with ecrecover and requires the recovered address to equal the member id. Afterwards the same 0x key moved part of its payout itself, through its NEAR eth-implicit account (NEP-518 rlp_execute), without our relayer.

Limits: our relayer still paid the join deposit, the stake and the gas, and the full circle flow through rlp_execute is not tested. The EIP-712 domain carries a salt bound to the NEAR network and contract account, not an EVM chainId.

Transactions and the spec: https://github.com/x207-labs/x207/blob/main/docs/evm-agents.md
```

Hashes (all on NEAR testnet, read back from RPC on 2026-11-05):

| What | Hash |
| --- | --- |
| `join_evm` | `E5dQ4Wn4TZyFUXheKvS1CS7whUaLHJ8sXp8hZ2zQJN3c` |
| EIP-712 voucher registered | `H19ZgnLYAmvsFio1R1dqp9941LoJQ9FR7TzMdCrArZbv` |
| `claim_evm` | `ERoUbiz3U2MgCkWR8YDuhzria7j8RvwYE8NCvvpziQMm` |
| `rlp_execute` by the 0x key | `J59PWbv4MHUz2o7DPJcNk1fUZGrnZc8xy7N39VTXwx6m` |

## Check before posting

- The domain sentence: `x207-v014.testnet` runs the salted wasm (on-chain code hash sha256 `743109cb…`, checked by Worker F). The domain is `EIP712Domain(string name,string version,bytes32 salt)`, salt = keccak256("near:" + network + ":" + contract id), no `chainId`, no `verifyingContract`; see [evm-agents.md](../evm-agents.md). If you deploy another version, check the sentence again.
- Do not call it a standard. It is one binding on one chain, with one run.
- No gas saving, no mainnet, no "autonomous" claim: the relayer was used.
