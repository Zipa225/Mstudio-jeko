// Reconnaissance vocale DU NAVIGATEUR (Web Speech API) : le moteur de secours, ou le moteur choisi quand la page /micro
// montre qu'il comprend mieux la voix de la personne qu'AethexAI. Absent de certains navigateurs (Firefox, par exemple).
// AethexAI continue de faire parler l'assistant dans tous les cas.

export interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

export function getRecognition(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const browserSpeechSupported = (): boolean => getRecognition() !== undefined;

export interface BrowserListening {
  stop(): void;
  /** `text` est vide si rien n'a été compris ; `error` est le code du navigateur (« not-allowed », « no-speech »...). */
  result: Promise<{ text: string; error?: string }>;
}

/** Écoute une phrase, puis s'arrête toute seule. À appeler depuis un geste de l'utilisateur (clic). */
export function recognizeOnce(lang = "fr-FR"): BrowserListening | undefined {
  const Ctor = getRecognition();
  if (!Ctor) return undefined;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let text = "";
  let error: string | undefined;
  const result = new Promise<{ text: string; error?: string }>((resolve) => {
    rec.onresult = (e) => {
      text = e.results[0]?.[0]?.transcript ?? "";
    };
    rec.onerror = (e) => {
      error = e.error ?? "erreur";
    };
    rec.onend = () => resolve({ text, ...(error ? { error } : {}) });
  });
  try {
    rec.start();
  } catch {
    return { stop: () => undefined, result: Promise.resolve({ text: "", error: "start-failed" }) };
  }
  return { stop: () => rec.stop(), result };
}
