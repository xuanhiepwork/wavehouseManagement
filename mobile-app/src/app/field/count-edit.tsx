import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { CountEditScreen } from '../../field/InventoryScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams();return <AuthGate><FieldWorkflowChrome workflow="count-edit"><CountEditScreen id={typeof id==='string'?id:''}/></FieldWorkflowChrome></AuthGate>;}
