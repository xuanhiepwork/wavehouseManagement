import { AuthGate } from '../../auth/AuthGate.tsx';
import { RosterScreen } from '../../field/RosterScreen.tsx';
export default function Route(){return <AuthGate><RosterScreen/></AuthGate>;}
