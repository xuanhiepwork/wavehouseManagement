import { AuthGate } from '../../auth/AuthGate.tsx';
import { ManagerScreen } from '../../field/ManagerScreen.tsx';
export default function Route(){return <AuthGate><ManagerScreen/></AuthGate>;}
