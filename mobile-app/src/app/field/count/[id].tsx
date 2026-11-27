import { FieldWorkflowChrome } from '../../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { CountScreen } from '../../../field/InventoryScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><FieldWorkflowChrome workflow="count-detail"><CountScreen id={typeof id==='string'?id:''}/></FieldWorkflowChrome></AuthGate>;}
