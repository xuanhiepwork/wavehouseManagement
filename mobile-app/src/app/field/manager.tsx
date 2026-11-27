import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { ManagerScreen } from '../../field/ManagerScreen.tsx';
export default function Route(){return <AuthGate><FieldWorkflowChrome workflow="manager"><ManagerScreen/></FieldWorkflowChrome></AuthGate>;}
