import { FieldWorkflowChrome } from '../../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { SalesReportScreen } from '../../../field/SalesScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><FieldWorkflowChrome workflow="sales-detail"><SalesReportScreen id={typeof id==='string'?id:''}/></FieldWorkflowChrome></AuthGate>;}
