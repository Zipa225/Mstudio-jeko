// Contrats entre le dialogue et le monde extérieur. Le dialogue ne connaît pas la fausse caisse :
// on la lui injecte, ce qui permet de vérifier en test qu'elle n'est appelée qu'après un « oui ».

import type { Wallet } from "./intent";
import type { Decision, Factor } from "./risk";

export interface Cashier {
  /** Lance une demande de paiement (encaissement). Le montant est en FCFA. */
  createPaymentRequest(args: { amount: number; wallet?: Wallet }): { id: string };
  /** Lance un transfert sortant. Le montant est en FCFA. */
  createTransfer(args: { amount: number; to: string }): { id: string };
}

/** La voix : transcrire ce que dit la vendeuse, et lui répondre à voix haute. */
export interface VoiceService {
  /** Voix vers texte. `mime` : audio/wav, audio/flac ou audio/ogg. */
  transcribe(audio: ArrayBuffer, mime: string): Promise<string>;
  /** Texte vers voix : un fichier WAV (24 kHz, mono). */
  synthesize(text: string): Promise<{ audio: ArrayBuffer; contentType: string }>;
}

/** Ce que le dialogue sait d'une opération au moment de la faire examiner. */
export interface RiskRequest {
  kind: "collect" | "send";
  /** FCFA. */
  amount: number;
  /** Compte bénéficiaire tel qu'Argus le reçoit (voir `Store.accountFor`). */
  beneficiaryAccount: string;
  beneficiaryKnown: boolean;
  /** Panier moyen du marchand et opérations des 10 dernières minutes : utiles au calcul local de secours. */
  avgTicket: number;
  previousOps: number;
  now: Date;
}

/** L'examen d'une opération : un score, une décision, les raisons. */
export interface RiskAssessment {
  /** 0 à 100. */
  score: number;
  decision: Decision;
  factors: Factor[];
  /** Explication courte et lisible, si le moteur en fournit une. */
  decisionReason?: string;
  source: "argus" | "local";
  modelVersion?: string;
  /** Vrai si le moteur voulu était injoignable et qu'on a utilisé le secours local. */
  degraded?: boolean;
}

/** Moteur de risque synchrone : le calcul local. */
export interface SyncRisk {
  readonly async?: false;
  assess(request: RiskRequest): RiskAssessment;
}

/** Moteur de risque qui répond par le réseau : l'API Argus. */
export interface AsyncRisk {
  readonly async: true;
  assess(request: RiskRequest): Promise<RiskAssessment>;
}
