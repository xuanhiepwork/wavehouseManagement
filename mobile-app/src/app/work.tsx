import { AuthGate } from '../auth/AuthGate.tsx';
import { WorkHub } from '../field/WorkHub.tsx';
export default function Route() { return <AuthGate><WorkHub /></AuthGate>; }
