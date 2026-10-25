export enum Stance { Stand = 0, Crouch = 1, Prone = 2, Rappel = 3 }
export const STANCE_NAME: Record<Stance, string> = { 0: 'Stand', 1: 'Crouch', 2: 'Prone', 3: 'Rappel' };
export type ActorKind = 'local' | 'remote' | 'bot' | 'agent' | 'hostage';
export type Side = 'attack' | 'defend' | 'terrorist' | 'hostage';
