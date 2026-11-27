import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { RosterScreen } from '../../field/RosterScreen.tsx';
export default function Route(){return <AuthGate><FieldWorkflowChrome workflow="roster"><RosterScreen/></FieldWorkflowChrome></AuthGate>;}
