# External interfaces E1–E8

The context diagram (Level 0) shows x207 as one system with eight external entities and fourteen data flows. This table lists each flow with its data format and the repository that owns the adapter for it.

| Entity | Role |
| --- | --- |
| E1 | Buyer agent. Calls paid endpoints and signs vouchers. |
| E2 | Seller agent (resource server). Serves requests and issues `PAYMENT-REQUIRED`. |
| E3 | Agent owner (human). Sets policy, funds the stake, holds keys. |
| E4 | Solver. Anyone who computes and submits a clearing proposal. |
| E5 | DAO member. Proposes and votes on parameter changes. |
| E6 | NEAR Intents and 1Click. `intents.near` and the 1Click API. |
| E7 | Other chains. Source or destination of funds. |
| E8 | NEAR AI Cloud. Inference for the demo agents. |

| # | Flow | Data and format | Adapter repo |
| --- | --- | --- | --- |
| 1 | E1 → x207 | HTTP request; x402 v2 `PAYMENT-SIGNATURE` header carrying an ed25519-signed cumulative voucher; residual payment as NEP-141 `ft_transfer_call` of USDT | `sdk` (`@x207/scheme` client), `agents` |
| 2 | x207 → E1 | HTTP `402` with `PAYMENT-REQUIRED`; result; `PAYMENT-RESPONSE` header; residual bill | `sdk` (`@x207/scheme`), `backend` (read API) |
| 3 | E2 → x207 | Service price in `PAYMENT-REQUIRED` `accepts`; service result; claim as a contract call | `sdk` (`@x207/scheme` server), `agents` |
| 4 | x207 → E2 | Facilitator `/verify` and `/settle` responses; USDT from a claim; 207 report | `sdk` (facilitator), `backend` (report) |
| 5 | E3 → x207 | USDT stake deposit; voucher signing key; policy settings | `contracts`, `frontend`, `agents` |
| 6 | x207 → E3 | Member status, credit limit, report | `backend` (read API), `frontend` |
| 7 | E4 → x207 | Clearing proposal in a `submit_clearing` contract call; barter bundle (roadmap) | `solver` |
| 8 | x207 → E4 | Obligation graph from the read API; solver fee | `backend` (read API), `contracts` |
| 9 | E5 → x207 | Sputnik DAO proposal and vote; the executed proposal calls `set_params` | `contracts` (`dao/`) |
| 10 | x207 → E5 | Active parameters through a contract view | `contracts`, `frontend` |
| 11 | x207 ↔ E6 | 1Click quote, deposit, and withdraw requests (HTTPS JSON); USDT deposit and withdraw on the Verifier by `ft_transfer_call` and `ft_withdraw` | `backend` (`src/settlement`) |
| 12 | E6 ↔ E7 | Cross-chain assets moved by NEAR Intents. x207 does not own this flow | none (external) |
| 13 | E1 ↔ E8 | Inference requests over the NEAR AI Cloud HTTPS chat API | `agents` |
| 14 | E2 ↔ E8 | Inference requests over the NEAR AI Cloud HTTPS chat API | `agents` |

Flows 11 to 13 depend on external services whose behavior was checked in the spike phase. Flow 12 is listed for completeness: the adapter is external.
