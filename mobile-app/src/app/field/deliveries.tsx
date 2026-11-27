import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { DeliveryScreen } from '../../field/DeliveryScreen.tsx';
export default function Route(){return <AuthGate><FieldWorkflowChrome workflow="deliveries"><DeliveryScreen/></FieldWorkflowChrome></AuthGate>;}
