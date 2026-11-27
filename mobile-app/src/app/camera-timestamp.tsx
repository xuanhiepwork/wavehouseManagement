import { useSyncExternalStore } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AuthGate } from '../auth/AuthGate.tsx';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { parseEvidenceTarget, type EvidenceKind } from '../field/evidence.store';
import { TimestampCameraScreen } from '../field/timestamp/TimestampCameraScreen';

export default function TimestampCameraRoute() {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const {targetType,targetId,kind}=useLocalSearchParams();
  const target=parseEvidenceTarget(targetType,targetId);
  const validKinds: Record<string, EvidenceKind[]> = {
    trip:['delivery'],stop:['receiving','damage'],count:['inventory','damage'],
    general:['delivery','receiving','inventory','damage'],
  };
  const chosenKind=typeof kind==='string'&&validKinds[target.type].includes(kind as EvidenceKind)
    ?kind as EvidenceKind :validKinds[target.type][0];
  // Immersive full-screen camera for signed-in users; AuthGate renders sign-in if needed.
  if(!user)return <AuthGate><></></AuthGate>;
  return <TimestampCameraScreen target={target} kind={chosenKind}/>;
}
