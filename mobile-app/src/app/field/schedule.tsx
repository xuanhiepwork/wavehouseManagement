import { AuthGate } from '../../auth/AuthGate.tsx';
import { ScheduleScreen } from '../../field/ScheduleScreen.tsx';
export default function Route(){return <AuthGate><ScheduleScreen/></AuthGate>;}
