import { useLocalSearchParams } from 'expo-router';
import { AuthGate } from '../auth/AuthGate.tsx';
import { CameraHub } from '../field/CameraHub.tsx';
export default function CameraRoute() {
  const {targetType,targetId,kind} = useLocalSearchParams();
  return <AuthGate><CameraHub targetType={targetType} targetId={targetId} initialKind={kind}/></AuthGate>;
}
