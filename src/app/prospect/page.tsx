"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startRecording, type Recording } from "../marchand/audio";
import { describeRecording, isDebugMode, micErrorMessage, sourceLine, voiceModeFrom, type VoiceMode } from "../marchand/view";
import styles from "./prospect.module.css";

interface Message {
  from: "agent" | "visitor";
  text: string;
  source?: string;
}

interface ProspectResponse {
  heard?: string;
  reply: string;
  speech: string;
  source?: string;
}

/** Un WAV vide : le jouer sur un geste du visiteur autorise ensuite la lecture des réponses sur téléphone. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

function Mic() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

const newVisitorId = () => `visiteur-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

export default function ProspectPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("browser");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [debugMode, setDebugMode] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{ url: string; summary: string } | undefined>();
  const started = useRef(false);
  const recordingRef = useRef<Recording | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const speak = useCallback(async (speech: string) => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: speech }),
        cache: "no-store",
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const player = playerRef.current ?? (playerRef.current = new Audio());
      player.onended = () => URL.revokeObjectURL(url);
      player.onerror = () => URL.revokeObjectURL(url);
      player.src = url;
      await player.play();
    } catch {
      /* la voix est un plus : le texte reste affiché */
    }
  }, []);

  const unlockAudio = useCallback(() => {
    const player = playerRef.current ?? (playerRef.current = new Audio());
    player.src = SILENT_WAV;
    void player.play().catch(() => undefined);
  }, []);

  /** Ajoute la réponse de l'agent ; `heard` (ce que le serveur a compris d'un enregistrement) devient la bulle du visiteur. */
  const receive = useCallback(
    (data: ProspectResponse, opts: { heardBubble: boolean; speak: boolean }) => {
      setMessages((m) => [
        ...m,
        ...(opts.heardBubble && data.heard ? [{ from: "visitor" as const, text: data.heard }] : []),
        { from: "agent", text: data.reply, source: data.source },
      ]);
      if (opts.speak && voiceMode === "aethex") void speak(data.speech);
    },
    [speak, voiceMode],
  );

  const post = useCallback(
    async (body: BodyInit, headers?: Record<string, string>): Promise<ProspectResponse | undefined> => {
      try {
        const res = await fetch("/api/prospect", { method: "POST", headers, body, cache: "no-store" });
        if (res.ok) return (await res.json()) as ProspectResponse;
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        setNotice(err.message ?? "Un problème est survenu. Réessaie.");
      } catch {
        setNotice("Un problème est survenu. Réessaie.");
      }
      return undefined;
    },
    [],
  );

  // Au chargement : session, source de la voix, puis démarrage de l'entretien (une seule fois, même en mode développement).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let id = "";
    try {
      id = sessionStorage.getItem("jeko-prospect") ?? "";
    } catch {
      /* stockage indisponible */
    }
    if (!id) {
      id = newVisitorId();
      try {
        sessionStorage.setItem("jeko-prospect", id);
      } catch {
        /* sans importance */
      }
    }
    setSessionId(id);
    setDebugMode(isDebugMode(window.location.search));
    void (async () => {
      let mode: VoiceMode = "browser";
      try {
        const health = await fetch("/api/health", { cache: "no-store" });
        if (health.ok) mode = voiceModeFrom(await health.json());
      } catch {
        /* texte seulement */
      }
      setVoiceMode(mode);
      const data = await post(JSON.stringify({ sessionId: id, text: "" }), { "content-type": "application/json" });
      if (data) setMessages([{ from: "agent", text: data.reply, source: data.source }]);
    })();
  }, [post]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendText(text: string) {
    setBusy(true);
    setNotice(undefined);
    setMessages((m) => [...m, { from: "visitor", text }]);
    const data = await post(JSON.stringify({ sessionId, text }), { "content-type": "application/json" });
    if (data) receive(data, { heardBubble: false, speak: true });
    setBusy(false);
  }

  async function sendAudio(wav: ArrayBuffer) {
    setBusy(true);
    const form = new FormData();
    form.set("sessionId", sessionId);
    form.set("audio", new Blob([wav], { type: "audio/wav" }), "voix.wav");
    const data = await post(form);
    if (data) receive(data, { heardBubble: true, speak: true });
    setBusy(false);
  }

  async function toggleMic() {
    if (busy) return;
    if (listening) {
      recordingRef.current?.stop();
      return;
    }
    unlockAudio();
    setNotice(undefined);
    try {
      const recording = await startRecording();
      recordingRef.current = recording;
      setListening(true);
      const heard = await recording.result;
      recordingRef.current = null;
      setListening(false);
      if (!heard) {
        setNotice("Je n'ai pas entendu. Réessaie.");
        return;
      }
      if (debugMode) {
        setDebugInfo((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(new Blob([heard.wav], { type: "audio/wav" })), summary: describeRecording(heard.stats) };
        });
      }
      await sendAudio(heard.wav);
    } catch (e) {
      recordingRef.current = null;
      setListening(false);
      setNotice(micErrorMessage((e as { name?: string })?.name, window.isSecureContext));
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !sessionId) return;
    unlockAudio();
    setInput("");
    void sendText(text);
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.tile} aria-hidden="true">J</div>
        <div>
          <h1 className={styles.title}>Découvrir Jèko</h1>
          <p className={styles.sub}>Prototype hackathon : entretien d'un futur marchand</p>
        </div>
      </header>

      <section className={styles.thread} aria-live="polite" aria-label="Discussion">
        {messages.map((m, i) => (
          <p key={i} className={`${styles.bubble} ${m.from === "agent" ? styles.agent : styles.visitor}`}>
            {m.text}
            {sourceLine(m.source) && <span className={styles.source}>{sourceLine(m.source)}</span>}
          </p>
        ))}
        <div ref={endRef} />
      </section>

      {notice && <p className={styles.notice} role="alert">{notice}</p>}

      {debugMode && debugInfo && (
        <div className={styles.notice}>
          <p style={{ margin: "0 0 8px" }}>Dernier enregistrement envoyé : {debugInfo.summary}</p>
          <audio controls src={debugInfo.url} style={{ width: "100%" }} />
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit}>
        {voiceMode === "aethex" && (
          <button
            type="button"
            className={`${styles.mic} ${listening ? styles.listening : ""}`}
            onClick={() => void toggleMic()}
            disabled={busy && !listening}
            aria-label={listening ? "Arrêter l'enregistrement" : "Parler"}
            aria-pressed={listening}
          >
            <Mic />
          </button>
        )}
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Écris ta réponse"
          aria-label="Ta réponse"
          autoComplete="off"
          maxLength={500}
        />
        <button type="submit" className={styles.send} disabled={busy || !input.trim()}>Envoyer</button>
      </form>

      <p className={styles.footer}>
        {voiceMode === "aethex" ? "Écris ou parle (voix AethexAI)." : "Écris ta réponse."} Aucun numéro ni nom n'est demandé.
      </p>
    </main>
  );
}
