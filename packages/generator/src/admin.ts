/**
 * Admin-only entry point (`@hugents/generator/admin`). Everything that can move a draft towards execution by a
 * human decision lives here, and is deliberately not re-exported from the package root, which agents and providers
 * import. The caller (the admin API, not built yet) must verify the identity of the actor first.
 */
export { approveDraft, editDraft, ApprovalError, type AdminActor } from "./approval.js";
