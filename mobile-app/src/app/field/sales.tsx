import { AuthGate } from '../../auth/AuthGate.tsx';
import { SalesScreen } from '../../field/SalesScreen.tsx';
export default function Route(){return <AuthGate><SalesScreen/></AuthGate>;}
