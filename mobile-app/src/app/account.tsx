import { AuthGate } from '../auth/AuthGate.tsx';
import { BrandAccountScreen } from '../design/doclap/BrandAccountScreen';
export default function Route() { return <AuthGate><BrandAccountScreen /></AuthGate>; }
