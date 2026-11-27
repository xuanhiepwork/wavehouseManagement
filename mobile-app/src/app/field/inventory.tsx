import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { InventoryScreen } from '../../field/InventoryScreen.tsx';
export default function Route(){return <AuthGate><FieldWorkflowChrome workflow="inventory"><InventoryScreen/></FieldWorkflowChrome></AuthGate>;}
