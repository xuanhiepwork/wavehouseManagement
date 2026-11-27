import { AuthGate } from '../../auth/AuthGate.tsx';
import { ReceivingScreen } from '../../field/ReceivingScreen.tsx';
export default function Route(){return <AuthGate><ReceivingScreen/></AuthGate>;}
