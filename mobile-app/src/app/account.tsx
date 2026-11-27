import { AuthGate } from '../auth/AuthGate.tsx';
import { AccountHub } from '../field/AccountHub.tsx';
export default function Route() { return <AuthGate><AccountHub /></AuthGate>; }
