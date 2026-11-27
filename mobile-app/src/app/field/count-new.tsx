import { FieldWorkflowChrome } from '../../field/FieldWorkflowChrome.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { useLocalSearchParams } from 'expo-router';
import { CountNewScreen } from '../../field/InventoryScreen.tsx';
import type { WorkShift } from '../../field/field.types.ts';
export default function Route(){const {branchId,shift}=useLocalSearchParams();return <AuthGate><FieldWorkflowChrome workflow="count-new"><CountNewScreen
  branchId={typeof branchId==='string'?branchId:''}
  shift={shift==='MORNING'||shift==='AFTERNOON'||shift==='EVENING'?shift as WorkShift:'MORNING'}/></FieldWorkflowChrome></AuthGate>;}
