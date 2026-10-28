// Contrats entre le dialogue et le monde extérieur. Le dialogue ne connaît pas la fausse caisse :
// on la lui injecte, ce qui permet de vérifier en test qu'elle n'est appelée qu'après un « oui ».

import type { Wallet } from "./intent";
import type { Decision, Factor } from "./risk";

/** Une demande de paiement lancée : `id` est notre référence (celle que le webhook ramène), `payUrl` le lien du client. */
export interface PaymentLaunch {
  id: string;
  payUrl?: string;
}

/** La caisse, quand elle répond tout de suite (fausse caisse). */
export interface Cashier {
  readonly async?: false;
  /** Lance une demande de paiement (encaissement). Le montant est en FCFA. */
  createPaymentRequest(args: { amount: number; wallet?: Wallet }): PaymentLaunch;
  /** Lance un transfert sortant. Le montant est en FCFA. */
  createTransfer(args: { amount: number; to: string }): { id: string };
  /** Un lien de même forme qu'un vrai, pour la réponse sous contrainte (qui doit ressembler à un succès). */
  decoyPayUrl?(id: string): string | undefined;
}

/** La caisse, quand elle répond par le réseau : l'API Jèko. */
export interface AsyncCashier {
  readonly async: true;
  createPaymentRequest(args: { amount: number; wallet?: Wallet }): Promise<PaymentLaunch>;
  createTransfer(args: { amount: number; to: string }): Promise<{ id: string }>;
  decoyPayUrl?(id: string): string | undefined;
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
