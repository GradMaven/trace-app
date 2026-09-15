/**
 * Split out from `storage.module.ts` to break a circular import: that module
 * imports `StorageController`, and the controller injects this token — if the
 * token were still declared in `storage.module.ts`, requiring the controller
 * from the module would re-enter the module's not-yet-finished CommonJS
 * `exports` and read `STORAGE_SERVICE` as `undefined` (Nest then fails to
 * resolve `StorageController`'s constructor param). Every other consumer of
 * this token still imports it from `storage.module.ts`, which re-exports it.
 */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
