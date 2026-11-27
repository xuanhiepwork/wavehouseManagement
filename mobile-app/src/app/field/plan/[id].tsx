import { AuthGate } from '../../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { PlanScreen } from '../../../field/ManagerScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><PlanScreen id={typeof id==='string'?id:''}/></AuthGate>;}
