import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { SalesEditScreen } from '../../field/SalesScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams<{id?:string}>();return <AuthGate><FieldWorkflowChrome workflow="sales-edit"><SalesEditScreen id={typeof id==='string'?id:undefined}/></FieldWorkflowChrome></AuthGate>;}
