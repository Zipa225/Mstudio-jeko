"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveMicProfile, savedMicProfile, savedSttEngine, startRecording, type Recording } from "./marchand/audio";
import { browserSpeechSupported, getRecognition, type Recognition } from "./marchand/browserSpeech";
import styles from "./marchand/marchand.module.css";
import {
  canSimulateClientPayment, demoPhrases, describeRecording, errorView, GREETING, heardLine, isDebugMode, isDemoPanel, isTestMode, jekoModeFrom, keepNumbersTogether, micErrorMessage,
  newSessionId, PAYMENT_POLL_MAX_MS, PAYMENT_POLL_MS, payLink, PHASE_LABEL, pickDemoName, saturationAdvice, screenKind, showConfirmButtons, sourceLine, voiceModeFrom,
  type Phase, type TurnView, type VoiceMode,
} from "./marchand/view";

/** Un WAV vide : jouer ce son sur un geste de la vendeuse autorise ensuite la lecture des réponses sur téléphone. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

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
  const [jekoLive, setJekoLive] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("browser");
  const [testMode, setTestMode] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [demoPanel, setDemoPanel] = useState(false);
  const [demoName, setDemoName] = useState("Traoré");
  const [debugInfo, setDebugInfo] = useState<{ url: string; summary: string } | undefined>();
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | undefined>();
  const recognitionRef = useRef<Recognition | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  /** Chaque lecture a un numéro : une réponse plus récente coupe la précédente. */
  const speakToken = useRef(0);
  const voiceModeRef = useRef<VoiceMode>("browser");

  // Initialisation côté navigateur : session, mode clavier, voix disponible, mode démonstration, source de la voix.
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
    setDebugMode(isDebugMode(window.location.search));
    setDemoPanel(isDemoPanel(window.location.search));
    setDemoName(pickDemoName(Math.random()));
    setVoiceSupported(getRecognition() !== undefined);
    fetch("/api/health", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((data: { demoMode?: boolean; voice?: unknown; jeko?: unknown } | undefined) => {
        setDemoMode(data?.demoMode === true);
        setJekoLive(jekoModeFrom(data) === "live");
        const mode = voiceModeFrom(data);
        voiceModeRef.current = mode;
        setVoiceMode(mode);
      })
      .catch(() => setDemoMode(false));
  }, []);

  const unlockAudio = useCallback(() => {
    const player = playerRef.current ?? (playerRef.current = new Audio());
    player.src = SILENT_WAV;
    void player.play().catch(() => undefined);
  }, []);

  const stopSpeaking = useCallback(() => {
    speakToken.current++;
    window.speechSynthesis?.cancel();
    playerRef.current?.pause();
  }, []);

  /** Voix du navigateur : le secours quand AethexAI n'est pas configuré ou échoue. */
  const speakWithBrowser = useCallback((speech: string, token: number) => {
    if (!("speechSynthesis" in window)) {
      setPhase("idle");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(speech);
    utterance.lang = "fr-FR";
    const done = () => {
      if (token === speakToken.current) setPhase("idle");
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    async (speech: string) => {
      const token = ++speakToken.current;
      window.speechSynthesis?.cancel();
      playerRef.current?.pause();
      setPhase("speaking");

      if (voiceModeRef.current === "aethex") {
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: speech }),
            cache: "no-store",
          });
          if (!res.ok) throw new Error(String(res.status));
          const url = URL.createObjectURL(await res.blob());
          if (token !== speakToken.current) {
            URL.revokeObjectURL(url);
            return;
          }
          const player = playerRef.current ?? (playerRef.current = new Audio());
          const end = () => {
            URL.revokeObjectURL(url);
            if (token === speakToken.current) setPhase("idle");
          };
          player.onended = end;
          player.onerror = end;
          player.src = url;
          await player.play();
          return;
        } catch {
          /* AethexAI indisponible ou lecture refusée : on bascule sur la voix du navigateur */
          if (token !== speakToken.current) return;
        }
      }
      speakWithBrowser(speech, token);
    },
    [speakWithBrowser],
  );

  /** Paiements lancés avec la vraie caisse et pas encore confirmés par Jèko : référence -> heure du lancement. */
  const pendingPayments = useRef(new Map<string, number>());

  const show = useCallback(
    (view: TurnView) => {
      if (view.payment?.id) pendingPayments.current.set(view.payment.id, Date.now());
      setResult(view);
      void speak(view.speech);
    },
    [speak],
  );

  // Avec la vraie caisse, le client paie de son côté : on demande au serveur si le webhook signé de Jèko est arrivé.
  useEffect(() => {
    if (!jekoLive) return;
    let stopped = false;
    const timer = setInterval(async () => {
      for (const [id, since] of [...pendingPayments.current]) {
        if (Date.now() - since > PAYMENT_POLL_MAX_MS) {
          pendingPayments.current.delete(id);
          continue;
        }
        try {
          const res = await fetch(`/api/payment?id=${encodeURIComponent(id)}`, { cache: "no-store" });
          if (!res.ok || stopped) continue;
          const data = (await res.json()) as TurnView & { status?: string };
          if (data.status === "paid" && pendingPayments.current.delete(id) && !stopped) show(data);
        } catch {
          /* réseau coupé : on réessaie au prochain passage */
        }
      }
    }, PAYMENT_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jekoLive, show]);

  const send = useCallback(
    async (text: string, macro?: "contrainte") => {
      setPhase("thinking");
      setNotice(undefined);
      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, text, ...(macro ? { macro } : {}) }),
          cache: "no-store",
        });
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setPhase("idle");
          setNotice(body.message ?? "Cette phrase n'est pas disponible.");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        show((await res.json()) as TurnView);
      } catch {
        show(errorView());
      }
    },
    [sessionId, show],
  );

  /** L'enregistrement part au serveur, qui le fait transcrire par AethexAI puis le traite comme du texte. */
  const sendAudio = useCallback(
    async (wav: ArrayBuffer) => {
      setPhase("thinking");
      setNotice(undefined);
      try {
        const form = new FormData();
        form.set("sessionId", sessionId);
        form.set("audio", new Blob([wav], { type: "audio/wav" }), "voix.wav");
        const res = await fetch("/api/turn", { method: "POST", body: form, cache: "no-store" });
        if (res.ok) {
          show((await res.json()) as TurnView);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setPhase("idle");
        setNotice(body.message ?? "Je n'ai pas pu comprendre l'audio. Réessaie.");
      } catch {
        show(errorView());
      }
    },
    [sessionId, show],
  );

  async function listenWithAethex() {
    setNotice(undefined);
    try {
      const profile = savedMicProfile();
      const recording = await startRecording(profile);
      recordingRef.current = recording;
      setPhase("listening");
      const heard = await recording.result;
      recordingRef.current = null;
      if (!heard) {
        setPhase("idle");
        setNotice("Je n'ai pas entendu. Réessaie.");
        return;
      }
      if (debugMode) {
        setDebugInfo((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(new Blob([heard.wav], { type: "audio/wav" })), summary: describeRecording(heard.stats) };
        });
      }
      const advice = saturationAdvice(profile, heard.stats);
      if (advice) {
        if (advice.nextProfile) saveMicProfile(advice.nextProfile);
        setPhase("idle");
        setNotice(advice.message);
        return;
      }
      await sendAudio(heard.wav);
    } catch (e) {
      recordingRef.current = null;
      setPhase("idle");
      setNotice(micErrorMessage((e as { name?: string })?.name, window.isSecureContext));
    }
  }

  function listenWithBrowser() {
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

  function toggleMic() {
    if (phase === "thinking") return;
    if (phase === "listening") {
      recordingRef.current?.stop();
      recognitionRef.current?.stop();
      return;
    }
    if (phase === "speaking") {
      stopSpeaking();
      setPhase("idle");
      return;
    }
    unlockAudio();
    // La page /micro peut avoir montré que la reconnaissance du navigateur comprend mieux cette voix : AethexAI parle toujours.
    const browserListens = savedSttEngine() === "navigateur" && browserSpeechSupported();
    if (voiceModeRef.current === "aethex" && !browserListens) void listenWithAethex();
    else listenWithBrowser();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || phase === "thinking") return;
    unlockAudio();
    setInput("");
    void send(text);
  }

  async function simulateClientPayment() {
    const id = result.payment?.id;
    if (!id) return;
    unlockAudio();
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
  const showKeyboard = testMode || (voiceMode === "browser" && !voiceSupported);
  const cardClass = `${styles.card} ${kind === "verify" ? styles.cardVerify : kind === "refusal" ? styles.cardRefusal : ""}`;
  const footer =
    voiceMode === "aethex"
      ? "Voix AethexAI."
      : voiceSupported
        ? "Voix du navigateur (secours : AethexAI n'est pas configuré)."
        : "Voix indisponible sur ce navigateur : mode clavier.";

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
        {sourceLine(result.source) && <p className={styles.heard}>{sourceLine(result.source)}</p>}
        {heard && <p className={styles.heard}>{heard}</p>}
      </section>

      {notice && <p className={styles.notice} role="alert">{notice}</p>}

      {debugMode && debugInfo && (
        <div className={styles.notice}>
          <p style={{ margin: "0 0 8px" }}>Dernier enregistrement envoyé : {debugInfo.summary}</p>
          <audio controls src={debugInfo.url} style={{ width: "100%" }} />
        </div>
      )}

      {showConfirmButtons(result) && (
        <div className={styles.confirm}>
          <button type="button" className={`${styles.choice} ${styles.yes}`} disabled={busy} onClick={() => { unlockAudio(); void send("oui"); }}>
            <Check size={36} /> Oui
          </button>
          <button type="button" className={`${styles.choice} ${styles.no}`} disabled={busy} onClick={() => { unlockAudio(); void send("non"); }}>
            <Cross /> Non
          </button>
        </div>
      )}

      {payLink(result) && (
        <a className={styles.payLink} href={payLink(result)} target="_blank" rel="noopener noreferrer">
          Lien de paiement du client
        </a>
      )}

      {canSimulateClientPayment(result, demoMode, jekoLive) && (
        <>
          {/* Simulation : le QR de la boutique que le client scanne. Il ne porte pas le montant (c'est l'image fournie par l'équipe). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.clientQr} src="/qr-client.png" alt="QR code que le client scanne pour payer" width={1284} height={1819} />
          <button type="button" className={styles.simulate} disabled={busy} onClick={() => void simulateClientPayment()}>
            Simuler : le client a payé
          </button>
        </>
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

      {demoPanel && demoMode && (
        <section className={styles.demoPanel} aria-label="Phrases de démonstration">
          <p className={styles.demoTitle}>Mode présentateur : ces boutons disent la phrase à la place de la voix</p>
          <div className={styles.demoGrid}>
            {demoPhrases(demoName).map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.demoButton}
                disabled={busy}
                onClick={() => {
                  unlockAudio();
                  void send(p.text, p.macro);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className={styles.demoReroll} disabled={busy} onClick={() => setDemoName((n) => pickDemoName(Math.random(), n))}>
            Autre prénom (le prénom doit être nouveau pour Argus)
          </button>
        </section>
      )}

      <p className={styles.footer}>{footer}</p>
    </main>
  );
}
