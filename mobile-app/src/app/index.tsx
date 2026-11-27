import { AuthGate } from '../auth/AuthGate.tsx';
import { FieldHome } from '../field/FieldHome.tsx';
export default function HomeRoute(){return <AuthGate><FieldHome/></AuthGate>;}
