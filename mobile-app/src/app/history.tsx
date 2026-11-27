import { AuthGate } from '../auth/AuthGate.tsx';
import { BrandHistoryScreen } from '../design/doclap/BrandHistoryScreen';
export default function Route() { return <AuthGate><BrandHistoryScreen /></AuthGate>; }
