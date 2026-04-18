/**
 * peer-deps — the single import surface of PeerJS for this package.
 *
 * Centralising the re-export keeps Phase 3 wiring easy to audit (grep
 * for peerjs returns a single file) and gives us one place to swap in
 * a bundled-local signaling server if PeerJS Cloud becomes unreliable
 * in V2 (§6 — PeerJS Cloud rate limits risk).
 */

export { Peer } from "peerjs";
export type { DataConnection } from "peerjs";
