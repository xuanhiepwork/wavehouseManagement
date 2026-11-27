/** Session data is intentionally process-memory-only: no token on disk or in Expo public config. */
export type MobileRole = 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
export type MobileWorkKind = 'SALES' | 'KITCHEN_DELIVERY' | null;
export interface MobileUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: MobileRole;
  readonly branchId: string | null;
  readonly areaId: string | null;
  readonly workKind: MobileWorkKind;
}
export interface AuthSnapshot {
  readonly user: MobileUser | null;
  readonly generation: number;
}
let token: string | null = null;
let snapshot: AuthSnapshot = Object.freeze({ user: null, generation: 0 });
const listeners = new Set<() => void>();
export function getAuthSnapshot(): AuthSnapshot { return snapshot; }
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function currentAccessToken(): string | null { return token; }
function publish(user: MobileUser | null) {
  snapshot = Object.freeze({ user, generation: snapshot.generation + 1 });
  for (const listener of listeners) listener();
}
export function beginAuthSession(nextToken: string, user: MobileUser): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nextToken)) throw new Error('Invalid session');
  token = nextToken;
  publish(Object.freeze({ ...user }));
}
export function clearAuthSession(): void {
  token = null;
  publish(null);
}
/** Ignore stale 401 responses from a session replaced by a newer login. */
export function clearAuthSessionIfTokenMatches(requestToken: string): void {
  if (token === requestToken) clearAuthSession();
}
