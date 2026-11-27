import { FieldWorkflowChrome } from '../../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { TripScreen } from '../../../field/DeliveryScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><FieldWorkflowChrome workflow="trip-detail"><TripScreen id={typeof id==='string'?id:''}/></FieldWorkflowChrome></AuthGate>;}
