"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./marchand/marchand.module.css";
import {
  canSimulateClientPayment, errorView, GREETING, heardLine, isTestMode, keepNumbersTogether, newSessionId, PHASE_LABEL,
  screenKind, showConfirmButtons, type Phase, type TurnView,
} from "./marchand/view";

// Reconnaissance vocale du navigateur : voix de secours, en attendant AethexAI.
interface Recognition {
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

function getRecognition(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function Mic() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function Check({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Cross({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Warning() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18v.01" />
    </svg>
  );
}

export default function MarchandPage() {
  const [result, setResult] = useState<TurnView>(GREETING);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | undefined>();
  const recognitionRef = useRef<Recognition | null>(null);

  // Initialisation côté navigateur : session, mode clavier, voix disponible, mode démonstration.
  useEffect(() => {
    let id = "";
    try {
      id = sessionStorage.getItem("jeko-session") ?? "";
    } catch {
      /* stockage indisponible : on garde un identifiant en mémoire */
    }
    if (!id) {
      id = newSessionId(crypto.getRandomValues(new Uint8Array(8)));
      try {
        sessionStorage.setItem("jeko-session", id);
      } catch {
        /* sans importance */
      }
    }
    setSessionId(id);
    setTestMode(isTestMode(window.location.search));
    setVoiceSupported(getRecognition() !== undefined);
    fetch("/api/health", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((data: { demoMode?: boolean } | undefined) => setDemoMode(data?.demoMode === true))
      .catch(() => setDemoMode(false));
  }, []);

  const speak = useCallback((speech: string) => {
    if (!("speechSynthesis" in window)) {
      setPhase("idle");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speech);
    utterance.lang = "fr-FR";
    utterance.onend = () => setPhase("idle");
    utterance.onerror = () => setPhase("idle");
    setPhase("speaking");
    window.speechSynthesis.speak(utterance);
  }, []);

  const show = useCallback(
    (view: TurnView) => {
      setResult(view);
      speak(view.speech);
    },
    [speak],
  );

  const send = useCallback(
    async (text: string) => {
      setPhase("thinking");
      setNotice(undefined);
      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, text }),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        show((await res.json()) as TurnView);
      } catch {
        show(errorView());
      }
    },
    [sessionId, show],
  );

  function toggleMic() {
    if (phase === "thinking") return;
    if (phase === "listening") {
      recognitionRef.current?.stop();
      return;
    }
    if (phase === "speaking") {
      window.speechSynthesis?.cancel();
      setPhase("idle");
      return;
    }
    const Ctor = getRecognition();
    if (!Ctor) {
      setNotice("Le micro n'est pas disponible ici : écris ta demande.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let heard = false;
    rec.onresult = (e) => {
      heard = true;
      void send(e.results[0]?.[0]?.transcript ?? "");
    };
    rec.onerror = (e) => {
      setNotice(e.error === "not-allowed" ? "Autorise le micro dans ton navigateur." : "Je n'ai pas entendu. Réessaie.");
    };
    rec.onend = () => {
      recognitionRef.current = null;
      if (!heard) setPhase("idle");
    };
    recognitionRef.current = rec;
    setNotice(undefined);
    setPhase("listening");
    rec.start();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || phase === "thinking") return;
    setInput("");
    void send(text);
  }

  async function simulateClientPayment() {
    const id = result.payment?.id;
    if (!id) return;
    setPhase("thinking");
    setNotice(undefined);
    try {
      const res = await fetch("/api/paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId: id }),
        cache: "no-store",
      });
      const data = (await res.json()) as TurnView & { ok?: boolean };
      if (res.ok && data.reply) show(data);
      else {
        setNotice("Le paiement n'a pas pu être simulé.");
        setPhase("idle");
      }
    } catch {
      show(errorView());
    }
  }

  const kind = screenKind(result);
  const busy = phase === "thinking";
  const heard = heardLine(result.heard);
  const showKeyboard = testMode || !voiceSupported;
  const cardClass = `${styles.card} ${kind === "verify" ? styles.cardVerify : kind === "refusal" ? styles.cardRefusal : ""}`;

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.tile} aria-hidden="true">J</div>
          <div>
            <h1 className={styles.name}>Jèko Business</h1>
            <p className={styles.proto}>Prototype hackathon : simule le bouton micro</p>
          </div>
        </div>
        <span className={styles.connected} role="img" aria-label="Connecté" />
      </header>

      <section className={cardClass} aria-live="polite">
        {kind === "success" && (
          <div className={`${styles.icon} ${styles.iconSuccess}`} aria-hidden="true">
            <Check />
          </div>
        )}
        {(kind === "verify" || kind === "refusal") && (
          <div className={`${styles.icon} ${styles.iconWarn}`} aria-hidden="true">
            <Warning />
          </div>
        )}
        <p className={styles.reply}>{keepNumbersTogether(result.reply)}</p>
        {heard && <p className={styles.heard}>{heard}</p>}
      </section>

      {notice && <p className={styles.notice} role="alert">{notice}</p>}

      {showConfirmButtons(result) && (
        <div className={styles.confirm}>
          <button type="button" className={`${styles.choice} ${styles.yes}`} disabled={busy} onClick={() => void send("oui")}>
            <Check size={36} /> Oui
          </button>
          <button type="button" className={`${styles.choice} ${styles.no}`} disabled={busy} onClick={() => void send("non")}>
            <Cross /> Non
          </button>
        </div>
      )}

      {canSimulateClientPayment(result, demoMode) && (
        <button type="button" className={styles.simulate} disabled={busy} onClick={() => void simulateClientPayment()}>
          Simuler : le client a payé
        </button>
      )}

      <div className={styles.micZone}>
        <div className={`${styles.micWrap} ${phase === "listening" ? styles.listening : ""} ${phase === "speaking" ? styles.speaking : ""}`}>
          <button
            type="button"
            className={styles.mic}
            onClick={toggleMic}
            aria-label={PHASE_LABEL[phase]}
            aria-pressed={phase === "listening"}
          >
            {phase === "thinking" ? (
              <span className={styles.dots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : (
              <Mic />
            )}
          </button>
        </div>
        <p className={styles.phase} role="status">{PHASE_LABEL[phase]}</p>
      </div>

      {showKeyboard && (
        <form className={styles.form} onSubmit={onSubmit}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Écris ta demande"
            aria-label="Ta demande"
            autoComplete="off"
            maxLength={500}
          />
          <button type="submit" className={styles.send} disabled={busy || !input.trim()}>Envoyer</button>
        </form>
      )}

      <p className={styles.footer}>
        {voiceSupported ? "Voix du navigateur (secours, en attendant AethexAI)." : "Voix indisponible sur ce navigateur : mode clavier."}
      </p>
    </main>
  );
}
