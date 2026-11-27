import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { ReceiveStopScreen } from '../../field/ReceivingScreen.tsx';
export default function Route(){const {tripId,stopId}=useLocalSearchParams();return <AuthGate><FieldWorkflowChrome workflow="receive-stop"><ReceiveStopScreen
  tripId={typeof tripId==='string'?tripId:''} stopId={typeof stopId==='string'?stopId:''}/></FieldWorkflowChrome></AuthGate>;}
