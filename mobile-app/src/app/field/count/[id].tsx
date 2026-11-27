import { AuthGate } from '../../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { CountScreen } from '../../../field/InventoryScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><CountScreen id={typeof id==='string'?id:''}/></AuthGate>;}
