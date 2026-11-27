import { AuthGate } from '../../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { SalesReportScreen } from '../../../field/SalesScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><SalesReportScreen id={typeof id==='string'?id:''}/></AuthGate>;}
