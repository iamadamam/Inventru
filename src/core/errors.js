'use strict';

/**
 * kind:
 *   network - no connection / timeout             (passes by itself)
 *   server  - 5xx from the server                 (passes by itself)
 *   auth    - this PC is not (or no longer) paired (needs someone to act)
 *   config  - wrong address / not an Inventru server (needs someone to act)
 *   disk    - "Just this PC": the list on this PC could not be opened or saved (tried again)
 * ambiguous: a write may or may not have been applied on the server.
 */
class SyncError extends Error {
  constructor(message, { kind = 'network', status = null, ambiguous = false } = {}) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    this.status = status;
    this.ambiguous = ambiguous;
  }
}
module.exports = { SyncError };
