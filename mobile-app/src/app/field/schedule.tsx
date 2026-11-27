import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { ScheduleScreen } from '../../field/ScheduleScreen.tsx';
export default function Route(){return <AuthGate><FieldWorkflowChrome workflow="schedule"><ScheduleScreen/></FieldWorkflowChrome></AuthGate>;}
