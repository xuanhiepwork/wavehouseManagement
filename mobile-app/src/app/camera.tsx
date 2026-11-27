import { AuthGate } from '../auth/AuthGate.tsx';
import { CameraHub } from '../field/CameraHub.tsx';
export default function Route() { return <AuthGate><CameraHub /></AuthGate>; }
