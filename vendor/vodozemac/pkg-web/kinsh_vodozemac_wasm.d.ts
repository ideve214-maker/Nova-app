/* tslint:disable */
/* eslint-disable */

export class Account {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create an inbound session from a received prekey message body.
     * The peer's identity key is extracted from the message itself
     * (libolm-compatible behaviour). Returns both the new session and
     * the decrypted plaintext of the initial message in one shot.
     */
    createInboundSession(prekey_message_body: string): InboundResult;
    /**
     * Create an outbound Olm session targeting a peer device, using their
     * identity key + one-time-key (or fallback prekey when pool is empty).
     * Both keys are base64.
     */
    createOutboundSession(their_identity_key: string, their_one_time_key: string): Session;
    /**
     * Returns the unpublished fallback key as a JSON string in the same
     * shape as `oneTimeKeys()` — `{ "curve25519": { "<id>": "<pub>" } }`.
     * Empty inner map if no unpublished fallback exists.
     */
    fallbackKey(): string;
    /**
     * Restore from a JSON pickle produced by `pickle()`.
     */
    static fromPickle(pickle: string): Account;
    generateFallbackKey(): void;
    generateOneTimeKeys(count: number): void;
    /**
     * JSON string `{ "curve25519": "<base64>", "ed25519": "<base64>" }`.
     * Returning JSON (rather than a JS Map) keeps the API drop-in for
     * libolm-shaped consumers — caller does `JSON.parse(account.identityKeys())`.
     */
    identityKeys(): string;
    markKeysAsPublished(): void;
    maxNumberOfOneTimeKeys(): number;
    constructor();
    /**
     * Returns unpublished one-time keys as a JSON string:
     * `{ "curve25519": { "<keyId>": "<publicKey>" } }`.
     * After `markKeysAsPublished`, the inner map is empty.
     */
    oneTimeKeys(): string;
    /**
     * Returns the JSON pickle string. Persist however appropriate for
     * the runtime.
     */
    pickle(): string;
    /**
     * Sign the given message with this account's Ed25519 identity key,
     * returning a base64-encoded signature.
     */
    sign(message: string): string;
}

/**
 * Outbound megolm session — one per (circle, sender device). The sender
 * encrypts with this and shares `sessionKey()` with members over Olm.
 */
export class GroupSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Encrypt, returning the base64 megolm message body. No type field —
     * megolm has a single message kind (contrast with Olm's prekey/normal).
     */
    encrypt(plaintext: string): string;
    /**
     * Restore from a JSON pickle produced by `pickle()`.
     */
    static fromPickle(pickle: string): GroupSession;
    /**
     * Ratchet index of the **next** message to be encrypted.
     */
    messageIndex(): number;
    constructor();
    /**
     * Returns the JSON pickle string.
     */
    pickle(): string;
    sessionId(): string;
    /**
     * Base64 session key at the **current** ratchet index. Share this with
     * group members (over Olm); they construct an `InboundGroupSession`
     * from it and can decrypt everything from this index onward.
     */
    sessionKey(): string;
}

/**
 * Inbound megolm session — one per received session key. Decrypt-only.
 */
export class InboundGroupSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decrypt a base64 megolm message body. Returns a JSON string
     * `{ "plaintext": "...", "messageIndex": n }`.
     */
    decrypt(message: string): string;
    /**
     * Export the session key at the given ratchet index (base64), e.g. for
     * sharing history with a newly joined member. Returns `undefined` when
     * the index is below `firstKnownIndex()`.
     */
    exportAt(index: number): string | undefined;
    /**
     * Lowest ratchet index this session can decrypt.
     */
    firstKnownIndex(): number;
    /**
     * Restore from a JSON pickle produced by `pickle()`.
     */
    static fromPickle(pickle: string): InboundGroupSession;
    /**
     * Construct from a base64 **exported** key produced by `exportAt()`.
     * Exported keys lose the signing chain, so sessions imported this way
     * can decrypt but cannot prove who created the session.
     */
    static import(exported_session_key: string): InboundGroupSession;
    /**
     * Construct from a base64 session key produced by
     * `GroupSession.sessionKey()`.
     */
    constructor(session_key: string);
    /**
     * Returns the JSON pickle string.
     */
    pickle(): string;
    sessionId(): string;
}

export class InboundResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Take ownership of the new session. Throws if called twice.
     */
    takeSession(): Session;
    readonly plaintext: string;
    /**
     * The peer's curve25519 identity key, extracted from the prekey
     * message body. Useful for on-prekey-message new-device discovery —
     * the SDK can use this to validate the sender against the cached
     * device list (or note a new device).
     */
    readonly senderIdentityKey: string;
}

export class Session {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decrypt a message of the given type (0 = PreKey, 1 = Normal).
     */
    decrypt(message_type: number, body: string): string;
    /**
     * JSON string `{ "type": 0|1, "body": "<base64>" }`. Type 0 = PreKey,
     * 1 = Normal.
     */
    encrypt(plaintext: string): string;
    /**
     * Restore from a JSON pickle produced by `pickle()`.
     */
    static fromPickle(pickle: string): Session;
    hasReceivedMessage(): boolean;
    /**
     * Returns the JSON pickle string.
     */
    pickle(): string;
    sessionId(): string;
}

export function module_start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_account_free: (a: number, b: number) => void;
    readonly __wbg_groupsession_free: (a: number, b: number) => void;
    readonly __wbg_inboundgroupsession_free: (a: number, b: number) => void;
    readonly __wbg_inboundresult_free: (a: number, b: number) => void;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly account_createInboundSession: (a: number, b: number, c: number) => [number, number, number];
    readonly account_createOutboundSession: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly account_fallbackKey: (a: number) => [number, number, number, number];
    readonly account_fromPickle: (a: number, b: number) => [number, number, number];
    readonly account_generateFallbackKey: (a: number) => void;
    readonly account_generateOneTimeKeys: (a: number, b: number) => void;
    readonly account_identityKeys: (a: number) => [number, number, number, number];
    readonly account_markKeysAsPublished: (a: number) => void;
    readonly account_maxNumberOfOneTimeKeys: (a: number) => number;
    readonly account_new: () => number;
    readonly account_oneTimeKeys: (a: number) => [number, number, number, number];
    readonly account_pickle: (a: number) => [number, number, number, number];
    readonly account_sign: (a: number, b: number, c: number) => [number, number];
    readonly groupsession_encrypt: (a: number, b: number, c: number) => [number, number];
    readonly groupsession_fromPickle: (a: number, b: number) => [number, number, number];
    readonly groupsession_messageIndex: (a: number) => number;
    readonly groupsession_new: () => number;
    readonly groupsession_pickle: (a: number) => [number, number, number, number];
    readonly groupsession_sessionId: (a: number) => [number, number];
    readonly groupsession_sessionKey: (a: number) => [number, number];
    readonly inboundgroupsession_decrypt: (a: number, b: number, c: number) => [number, number, number, number];
    readonly inboundgroupsession_exportAt: (a: number, b: number) => [number, number];
    readonly inboundgroupsession_firstKnownIndex: (a: number) => number;
    readonly inboundgroupsession_fromPickle: (a: number, b: number) => [number, number, number];
    readonly inboundgroupsession_import: (a: number, b: number) => [number, number, number];
    readonly inboundgroupsession_new: (a: number, b: number) => [number, number, number];
    readonly inboundgroupsession_pickle: (a: number) => [number, number, number, number];
    readonly inboundgroupsession_sessionId: (a: number) => [number, number];
    readonly inboundresult_plaintext: (a: number) => [number, number];
    readonly inboundresult_senderIdentityKey: (a: number) => [number, number];
    readonly inboundresult_takeSession: (a: number) => [number, number, number];
    readonly module_start: () => void;
    readonly session_decrypt: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly session_encrypt: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_fromPickle: (a: number, b: number) => [number, number, number];
    readonly session_hasReceivedMessage: (a: number) => number;
    readonly session_pickle: (a: number) => [number, number, number, number];
    readonly session_sessionId: (a: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
