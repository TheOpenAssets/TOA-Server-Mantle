# Cross-Network Authentication Plan

## Document Purpose

This plan addresses how authentication works across the Mantle (EVM) and Stellar networks. The platform is wallet-dependent — users prove identity by signing a challenge message with their private key rather than by entering a password. Since EVM and Stellar wallets use fundamentally different cryptographic systems, the backend must verify signatures differently depending on which network a user belongs to. Everything else in the auth flow — JWT issuance, nonce challenges, session management, Redis/MongoDB storage, role-based access, KYC gating — is already network-agnostic and requires no changes.

---

## Part 1 — How The Current Auth Flow Works

Before planning changes, it is critical to understand exactly what the current flow does and why most of it is already correct for a multi-network world.

When a user wants to log in, they first request a challenge from the backend by sending their wallet address. The backend generates a UUID nonce, stores it in Redis keyed to the wallet address with a 60-second TTL, and returns a human-readable challenge message containing the nonce and a timestamp. The challenge message currently reads: "Sign this message to authenticate with Mantle RWA Platform. Nonce: {uuid}. Timestamp: {epoch}."

The user takes this message to their wallet application — MetaMask for EVM, Freighter for Stellar — and signs it with their private key. They then POST the original message plus the hex signature back to the backend login endpoint. The backend extracts the nonce from the message, checks it against Redis to confirm it hasn't expired or been reused, verifies the signature cryptographically, cleans up Redis, and then either finds an existing user record in MongoDB or creates a new one. Finally, it issues a JWT access token stored in Redis and a refresh token stored in MongoDB.

Every single part of this flow — nonce lifecycle, Redis storage, MongoDB user/session management, JWT structure, token rotation, logout, the KYC guard — works identically regardless of which blockchain the wallet belongs to. The wallet address is stored as an opaque string. The JWT payload carries the wallet address as a string. The Redis keys are built from wallet addresses as strings. None of these components make any assumption about wallet format.

The one and only piece that is network-coupled is the `SignatureService`, which calls `viem.verifyMessage()`. This function implements EIP-191 ECDSA signature recovery — a protocol specific to the Ethereum ecosystem. It is entirely incompatible with Stellar wallets.

---

## Part 2 — The Cryptographic Difference Between Networks

Understanding why the verification logic must diverge requires understanding what each network does when it "signs a message."

For EVM wallets, signing a message means hashing it under the EIP-191 standard (prepending `\x19Ethereum Signed Message:\n{length}` before computing the keccak256 hash), then applying ECDSA over the secp256k1 curve. The result is a 65-byte signature typically encoded as a 132-character hex string starting with `0x`. Verification works by recovering the public key from the signature and hash, deriving the Ethereum address from that public key, and checking that it matches the claimed address. The `viem.verifyMessage()` function does all of this automatically.

For Stellar wallets, the cryptography is fundamentally different. Stellar uses Ed25519 keypairs instead of secp256k1. A Stellar public key is a 32-byte Ed25519 key encoded in Strkey format — always starting with the letter G, always exactly 56 characters, using base32 encoding. When Freighter (the standard Stellar browser wallet) signs an arbitrary message, it signs the raw UTF-8 bytes of the message string directly — no prefix, no hashing wrapper like EIP-191. The result is a 64-byte Ed25519 signature that Freighter encodes as a base64 string. Verification requires decoding the Strkey public key to raw bytes, decoding the base64 signature to raw bytes, encoding the message to UTF-8 bytes, and calling the Ed25519 verify operation — which the Stellar SDK provides.

These two signing protocols are completely incompatible. A signature produced by a Stellar wallet cannot be verified with EVM tooling, and vice versa. The backend needs to dispatch to the correct verification path based on which kind of wallet is presenting credentials.

---

## Part 3 — Wallet Type Detection

Since the address format is unique to each network, we can determine which verification path to use by inspecting the wallet address itself. This requires no changes to the API — no new fields, no explicit network declaration from the client.

An EVM address always starts with `0x` and is exactly 42 characters long (including the prefix), consisting of hexadecimal digits optionally in EIP-55 checksum mixed case. A Stellar public key always starts with the uppercase letter `G` and is exactly 56 characters long, consisting of base32-alphabet characters.

These formats are mutually exclusive — there is no address that could be mistaken for both. A small utility function that inspects the first character and length of the wallet address string can reliably classify it as EVM, Stellar, or invalid. This detection utility is called once per request at the start of both the challenge and login flows to route all subsequent logic correctly.

Because network detection happens at runtime per request, the auth system naturally supports any mix of wallet types without requiring a deployment-level switch. A Stellar user and a Mantle user can authenticate against the same running backend instance simultaneously. This is more flexible than the `NETWORK_TYPE` master switch used elsewhere, which is appropriate for auth since identity is a universal concern.

---

## Part 4 — The AuthVerificationAdapter Interface

The current `SignatureService` is a single class with a single `verifySignature()` method that directly calls viem. To support multiple networks, this becomes an interface implemented by two distinct adapters, and the service that coordinates authentication delegates to the correct adapter at runtime.

The interface defines one method: given a wallet address, the original challenge message, and the signature provided by the user, return a boolean indicating whether the signature is cryptographically valid. Both EVM and Stellar adapters conform to this contract.

The EVM adapter is a direct translation of the existing `SignatureService`. It wraps `viem.verifyMessage()`, casts the inputs to the required viem types, and returns the result. The existing error handling (catch and return false) is preserved.

The Stellar adapter imports the Stellar SDK. It takes the challenge message string and encodes it to a UTF-8 byte buffer, decodes the incoming base64 signature to a byte buffer, constructs a Stellar `Keypair` object from the Strkey-encoded public key, and calls the keypair's `verify()` method with the message bytes and signature bytes. Like the EVM adapter, it wraps all of this in a try-catch that returns false on any failure, including an invalid Strkey format.

The routing logic lives in the refactored `SignatureService`. It calls the wallet detector to classify the address, then delegates to the appropriate adapter. This keeps the adapters pure and testable in isolation.

---

## Part 5 — Admin Whitelist Normalization Bug

There is an active bug in the admin whitelist loading code. When `AuthService` initializes, it reads `configs/approved_admins.json` and normalizes every address to lowercase by calling `.toLowerCase()` on each entry. It then checks admin status by lowercasing the incoming wallet address and comparing. The `approved_admins.json` file currently contains both EVM and Stellar addresses.

This is wrong for Stellar addresses. Strkey encoding is case-insensitive by specification, and the Stellar SDK always produces uppercase canonical keys. Lowercasing `GCYHVCO3G7I6VJUS5FRWAUKYOCAFFTEYRIYS3CQEHR5ALXY2WP736ISQ` produces `gcyhvco3g7i6vjus5frwaukyocaffteyriys3cqehr5alxy2wp736isq`. If both the stored value and the incoming comparison are lowercased consistently, the check accidentally works — but this is fragile and misleading. More importantly, if the Stellar address is ever used elsewhere in the codebase for an SDK call (like constructing a Keypair) after being retrieved from this normalized list, it will fail because the SDK expects valid Strkey uppercase.

The fix is to normalize each address according to its type. EVM addresses are lowercased (this is the established convention in the Ethereum ecosystem). Stellar addresses are converted to uppercase. The wallet type detection utility handles this, so the normalization is automatic and consistent. The `isApprovedAdmin()` check applies the same type-aware normalization to the incoming address before comparison.

---

## Part 6 — Wallet Address Canonical Storage

When a new user is created in MongoDB during login, their wallet address is stored as-is from the request. EVM wallets often send EIP-55 checksummed addresses (mixed case like `0x23e67597f0898f747Fa3291C8920168adF9455D0`). If a different client submits the same address in all-lowercase, `findOne({ walletAddress })` will find no match and create a duplicate user. This is a pre-existing bug that becomes more visible with multi-network support.

The canonical storage convention must be enforced before any MongoDB read or write. At the start of both `createChallenge()` and `login()`, the incoming wallet address should be normalized to its canonical form — lowercase for EVM, uppercase for Stellar — before being used as a Redis key or MongoDB query field. This ensures that two requests for the same wallet always map to the same user record regardless of the case in which the address was submitted.

---

## Part 7 — Challenge Message Update

The current challenge message contains the string "Mantle RWA Platform." When the platform is deployed for Stellar, this branding is incorrect and confusing. The message should be configurable via an environment variable — `APP_NAME` — with a fallback of "Open Assets Platform."

Beyond the name, the message format itself requires no changes. The nonce UUID, the timestamp, and the overall structure all work for both networks. Freighter on Stellar and MetaMask on EVM can both sign a plain string message. The nonce extraction regex on the backend does not need modification.

---

## Part 8 — JWT Payload Network Field

The current JWT access token payload carries `sub` (MongoDB user ID), `wallet` (wallet address string), `role`, `kyc`, and `jti`. It does not identify which network the token belongs to.

Adding a `network` field to the JWT payload makes tokens self-describing and useful for any downstream service that needs to know which blockchain adapter to invoke for a particular user's operations. The network is derived from the wallet address at token generation time using the same wallet type detection utility. For EVM wallets it carries `mantle`, for Stellar it carries `stellar`. This mirrors the `NETWORK_TYPE` convention used across the rest of the codebase.

The JWT strategy that validates tokens on protected routes will include this `network` field in the user object it attaches to the request, making it available to all downstream controllers and services.

---

## Part 9 — DTO Validation

The `walletAddress` field in `ChallengeDto` and `LoginDto` currently accepts any non-empty string. This means garbage values pass through to the service layer before being rejected. A custom class-validator decorator should be added that accepts exactly two formats — a 42-character hex string starting with `0x`, or a 56-character Strkey string starting with `G`. Any other format is rejected at the DTO validation layer with a clear error message before reaching service code.

---

## Part 10 — Module Structure

### Files to Create

The first new file is the `AuthVerificationAdapter` interface. It lives in a new `adapters` folder inside the auth module. The interface has a single method declaration that both network implementations must fulfill.

The second new file is the EVM implementation. It contains the extracted and lightly refactored logic from the existing `SignatureService`, using viem.

The third new file is the Stellar implementation. It uses the Stellar SDK's `Keypair` class for Ed25519 verification.

The fourth new file is the wallet detector utility, housed in a `utils` folder inside the auth module. It exports a function that classifies a wallet address string and returns its network type, and a separate function that normalizes an address to its canonical form for a given type.

The fifth new file is `context.md` for the auth module, which is required by the project's folder context rules. Since this is the first modification to the auth module's architecture, the context document must be created.

### Files to Modify

`signature.service.ts` is refactored from a viem-calling class into a routing service that injects both adapters, calls the detector, and dispatches to the correct adapter. The public API (method name, parameters, return type) remains identical so that `auth.service.ts` requires no structural change for this step.

`auth.service.ts` requires three changes: the admin whitelist loading uses type-aware normalization instead of blanket toLowerCase; the `createChallenge()` method normalizes the incoming wallet address before Redis key construction and uses `APP_NAME` from config for the message; the `login()` method normalizes the incoming address before all Redis and MongoDB lookups.

`auth.dto.ts` gains a custom validator for the wallet address field.

`auth.module.ts` registers the two adapter classes as providers so they can be injected.

`generateTokens()` in `auth.service.ts` adds the `network` field to the access token payload, derived from the wallet address using the detector utility.

### Dependency to Add

The Stellar SDK (`@stellar/stellar-base` or `stellar-sdk`) must be added to the backend package's dependencies if it is not already present. The Stellar adapter imports only the `Keypair` class, which is a lightweight dependency. The full `stellar-sdk` may already be present for the blockchain adapter layer — if so, no new dependency is needed.

---

## Part 11 — What Does Not Change

To be explicit about the scope: nothing about the challenge endpoint mechanics changes. Nothing about JWT signing, verification, or rotation changes. Nothing about the Redis session model changes. Nothing about MongoDB user or session schemas changes. Nothing about the KYC guard changes. Nothing about the role system or the admin whitelist file format changes. The login, refresh, logout, and profile endpoints keep their exact current signatures. The auth guard keeps its current implementation.

The changes are confined to: signature verification routing, wallet address normalization on input, challenge message text, JWT payload one new field, DTO validation, and a new context.md.

---

## Part 12 — Invariants

The following must remain true after implementation:

Every existing EVM user who is currently stored in MongoDB must continue to authenticate without any migration. Their stored wallet addresses are lowercased EVM addresses; the normalization function must produce the same lowercase result.

An invalid signature from either network must always produce an `UnauthorizedException`, never a 500. The adapters must catch all errors.

A nonce can only be used once. The cleanup logic in `login()` must delete the nonce from Redis regardless of which adapter is used.

The admin whitelist check must be applied both at challenge time and again at login time as defense in depth. Both checks must use the same type-aware normalization.

The JWT `network` field must match the actual wallet format — it must not be possible to get a token claiming to be Stellar while authenticating with an EVM wallet.

---

## Part 13 — Testing Checklist

Before considering this implementation complete, the following scenarios must be manually verified:

EVM wallet can request a challenge, sign it, and receive a JWT. EVM admin wallet listed in `approved_admins.json` can authenticate with the ADMIN role. EVM wallet with an unknown address attempting ADMIN role is rejected. An expired or reused nonce is rejected. An invalid EVM signature is rejected.

Stellar wallet can request a challenge, sign it with Freighter, and receive a JWT. Stellar admin wallet listed in `approved_admins.json` can authenticate with the ADMIN role. An invalid Stellar signature (tampered base64) is rejected. A Stellar address with incorrect format is rejected at DTO validation.

An EVM wallet address submitted in mixed checksum case (EIP-55) must map to the same user as the same address submitted in all lowercase.

A request with a completely invalid wallet address string that matches neither format must fail at DTO validation before reaching the service.

The JWT issued for a Stellar wallet must carry `network: stellar` in the payload. The JWT issued for an EVM wallet must carry `network: mantle` in the payload.
