import { AuthGate } from '../../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { TripScreen } from '../../../field/DeliveryScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><TripScreen id={typeof id==='string'?id:''}/></AuthGate>;}
