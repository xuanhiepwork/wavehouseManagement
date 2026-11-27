import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { SalesScreen } from '../../field/SalesScreen.tsx';
export default function Route(){return <AuthGate><FieldWorkflowChrome workflow="sales"><SalesScreen/></FieldWorkflowChrome></AuthGate>;}
