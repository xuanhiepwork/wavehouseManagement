import { AuthGate } from '../auth/AuthGate.tsx';
import { HistoryHub } from '../field/HistoryHub.tsx';
export default function Route() { return <AuthGate><HistoryHub /></AuthGate>; }
