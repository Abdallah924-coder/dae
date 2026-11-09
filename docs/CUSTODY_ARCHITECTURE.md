# DAE custodial wallet architecture

## Operating decision

DAE operates in the Republic of the Congo and is the custodian of customer assets. The target design uses a DAE-controlled hierarchical deterministic (HD) root to derive a separate deposit address for each customer account and supported chain/network. The root key remains under DAE's controlled custody in an isolated signer/HSM; customer accounts never receive or control private keys. This file records the security boundary and activation requirements; it is not evidence that DAE has an authorization to provide custody services.

## Key boundary

- The web/API process and MongoDB must never contain a seed phrase, root private key, child private key, signing share, or unencrypted key backup.
- A separately administered, DAE-controlled signer boundary owns the root material. The web/API may derive watch-only customer addresses from an xpub and submit a withdrawal proposal, but it cannot sign or broadcast by itself. The current BSC implementation is a self-hosted Node.js signer process; it is not an HSM or MPC signer.
- Production key generation and backup ceremonies require multiple trusted operators, offline recovery copies, documented access, and a tested recovery procedure. Never generate the production root on a developer workstation or in a web request.
- The `Wallet` model stores public address and derivation metadata only. It intentionally has no private-key or seed fields.
- Address uniqueness is enforced only for wallets with a populated public address. Placeholder records for the same network must coexist across customer accounts; startup migrates the former sparse compound index before serving requests.

## HD derivation scope

Use established, reviewed implementations of BIP-32, BIP-39 and chain-specific derivation standards; do not implement elliptic-curve or mnemonic primitives in this application. A hardened customer/account branch must be derived inside the signer. A watch-only public derivation key can then be handed to the address service where that chain supports public child derivation.

The application reserves a unique numeric account index per customer within the non-hardened 31-bit index range. That index is only a public identifier for the signer's derivation policy; it is not a key or a secret. DAE's isolated signer derives the customer's address from its protected root using a documented path for each supported chain/network, then returns only the public address and derivation metadata. Keep address allocation idempotent so retries cannot silently create a different destination. Root generation, backups and recovery are controlled by DAE through a documented multi-operator ceremony.

The supported assets do not share one derivation implementation:

- Bitcoin needs a documented script/address policy and its own coin path.
- EVM networks (Ethereum, BNB Smart Chain, Polygon, Arbitrum and Optimism) can share an EVM account address; token balances are separate assets on a chain, not separate keypairs.
- TRON needs chain-specific address encoding and token contract configuration.
- Solana uses Ed25519 and a distinct derivation/signing path; it cannot be assumed to work with a secp256k1 BIP-32 xpub service.
- Lightning is a channel/node service, not a normal on-chain address. Keep it unavailable until a separate Lightning node and liquidity controls exist.

No address is marked active until a production signer has derived it, a chain watcher has verified it, and the service has passed reconciliation checks.

## Ledger and movement controls

- Store asset quantities as integer atomic units and record the approved decimal precision for each asset/network; never use JavaScript floating-point numbers for wallet balances. Token precision comes from the chain-specific contract allowlist, not from the ticker symbol.
- Use the customer ledger account references `customer:<customer ObjectId>:available`, `customer:<customer ObjectId>:reserved` and `customer:<customer ObjectId>:staked` consistently so portfolio reads cannot combine spendable, reserved and locked funds.
- Record posted balances through immutable, balanced double-entry transactions. Corrections use a new compensating transaction; they never edit or delete a posted entry.
- Order status events are append-only in the application and identify the customer, guest, admin, or system actor. The production MongoDB role should deny update/delete access to the event collection; ODM middleware alone is not a database security boundary.
- Order creation, payment declaration, administrative status transitions and automatic expiration write the order and its append-only event in one MongoDB transaction. The `npm run expire` job is a one-shot batch that should be scheduled by deployment operations and requires a transaction-capable MongoDB topology.
- Customer account lock/unlock actions and their operator reason are recorded in an append-only audit collection in the same MongoDB transaction as the status change and session revocation. This administrative action requires MongoDB replica-set transaction support.
- Password recovery consumes its one-time challenge, changes the password, and revokes all customer sessions in one MongoDB transaction. Keep account recovery unavailable unless the connected MongoDB topology supports transactions.
- Enforce append-only ledger permissions at the database role level as well as in the application model. ODM middleware does not constrain direct database access or every bulk-write path.
- The internal ledger service hashes canonical postings, rejects reuse of an idempotency key for a different payload, and uses integer atomic units. It is not mounted as a customer endpoint and does not authorize or execute a deposit, withdrawal, or staking movement.
- Customer ledger postings require MongoDB multi-document transactions. Per-account/asset/network lock records serialize concurrent postings, and a debit is rejected if it would make that customer compartment negative. Customer account references are normalized and malformed `customer:` references are rejected.
- Deposits credit the customer ledger only after a chain-specific confirmation policy and an idempotent reconciliation against the chain watcher.
- Identify each deposit by network, transaction hash and parsed transfer-event index (output/log/instruction position), because a single chain transaction may contain multiple transfers. The deposit, withdrawal and staking ledger reference fields are unique when present so a ledger posting cannot be attached to multiple movement records.
- Record transfers to an assigned address even while the customer is locked or awaiting KYC approval. Keep the amount out of the available ledger and reconcile the pending deposit after the account is active and its KYC is approved; do not advance past an uncredited transfer without persisting it.
- Index every assigned active BSC address regardless of account/KYC status. When indexer behavior changes, bump its cursor version and replay from the configured start block; ledger idempotency and unique chain event keys make replay safe.
- Withdrawals reserve funds first, require KYC and risk checks, use step-up authentication and a review policy, then enter a signer queue. Broadcast and finality are distinct states.
- Staking remains unavailable until a specific protocol, custody arrangement, validator/counterparty, lock/unbonding schedule, reward source, fee policy and customer disclosures are approved.
- Default-deny all money-moving capabilities. A UI button or a database flag alone must never activate signing, crediting, withdrawals or staking.
- A withdrawal transfer job is created in a non-signable prepared state. The worker may queue it only after idempotently posting the customer's available-to-reserved ledger transfer; it can recover this preparation after a process restart before claiming queued jobs for signing.
- Customer withdrawal requests require a recent customer session; customer sessions are issued only after the configured e-mail and SMS OTP checks succeed.
- KYC approval follows an audited `not_started → pending → approved/rejected` workflow. Approval requires an internal reference to the identity file reviewed through DAE's existing process; the application stores the reference and decision reason, never the identity scan or document number.

## Required before live custody

1. Written regulatory assessment and any required COSUMAF/COBAC or other approvals for the exact services DAE will provide.
2. Selected HSM/MPC signer, chain nodes/indexers, token contract allowlist, confirmation policies and incident response owner.
3. Independent security review of key ceremony, signer policy, ledger, reconciliation and withdrawal approval flow.
4. KYC/AML provider and retention/access policy for identity documents. Do not store identity scans in MongoDB or application logs.
5. Operational limits, sanctions/transaction monitoring, customer support and tested disaster recovery.

## Current state

The application handles manual exchange orders and implements the BSC custody path for Binance-Peg BSC-USD (18 decimals): watch-only customer address derivation from the configured xpub, a confirmation-aware deposit indexer, double-entry ledger credits, withdrawal balance reservation, a local signer queue, confirmation tracking, and admin-triggered collections to the master wallet. Signed transactions are journaled encrypted so the local signer can resume after interruption; the mnemonic remains on the DAE-controlled signer host and is never sent to Render or MongoDB. The signer and indexer run as separate supervised processes against the application database.

`BSC_DEPOSITS_ENABLED`, `BSC_WITHDRAWALS_ENABLED`, and `BSC_SWEEPS_ENABLED` default to `false`. API readiness also requires the appropriate BSC configuration, transaction-capable MongoDB, and a recent worker heartbeat; customer deposit addresses are hidden until deposit processing is ready and the customer's KYC is approved. Staking is intentionally disabled. This implementation has not thereby received an independent security audit or regulatory authorization. Before production asset movement, complete the required legal assessment, key custody and recovery procedures, access controls, transaction limits and monitoring, reconciliation, incident response, and independent security review listed above.
