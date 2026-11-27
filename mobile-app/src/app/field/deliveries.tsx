import { AuthGate } from '../../auth/AuthGate.tsx';
import { DeliveryScreen } from '../../field/DeliveryScreen.tsx';
export default function Route(){return <AuthGate><DeliveryScreen/></AuthGate>;}
