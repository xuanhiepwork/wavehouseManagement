import { AuthGate } from '../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { SalesEditScreen } from '../../field/SalesScreen.tsx';
export default function Route(){const {id}=useLocalSearchParams<{id?:string}>();return <AuthGate><SalesEditScreen id={typeof id==='string'?id:undefined}/></AuthGate>;}
