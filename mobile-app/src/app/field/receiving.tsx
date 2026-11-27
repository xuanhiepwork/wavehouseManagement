import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { ReceivingScreen } from '../../field/ReceivingScreen.tsx';
export default function Route(){return <AuthGate><FieldWorkflowChrome workflow="receiving"><ReceivingScreen/></FieldWorkflowChrome></AuthGate>;}
