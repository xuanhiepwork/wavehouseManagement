import { AuthGate } from '../../auth/AuthGate.tsx';
import { InventoryScreen } from '../../field/InventoryScreen.tsx';
export default function Route(){return <AuthGate><InventoryScreen/></AuthGate>;}
