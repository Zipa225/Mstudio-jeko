"use client";

import { useEffect, useRef, useState } from "react";
import {
  CLIPPING_LIMIT, MIC_PROFILES, saveMicProfile, saveSttEngine, startRecording, type MicProfile, type Recording, type SttEngine,
} from "../marchand/audio";
import { browserSpeechSupported, recognizeOnce, type BrowserListening } from "../marchand/browserSpeech";
import { describeRecording, micErrorMessage, voiceModeFrom } from "../marchand/view";
import styles from "../prospect/prospect.module.css";
import MicCheck from "./MicCheck";
import { bestProfile, chooseEngine, EXPECTED_PHRASE, phraseScore, scoreLabel } from "./score";

const PROFILES = Object.keys(MIC_PROFILES) as MicProfile[];

interface Result {
  profile: MicProfile;
  heard?: string;
  summary?: string;
  url?: string;
  problem?: string;
  saturated?: boolean;
}

type Step = "idle" | "listening" | "sending" | "done";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function MicroPage() {
  const [voiceReady, setVoiceReady] = useState<boolean | undefined>();
  const [step, setStep] = useState<Step>("idle");
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [chosen, setChosen] = useState<MicProfile | undefined>();
  const [browserHeard, setBrowserHeard] = useState<string | undefined>();
  const [browserProblem, setBrowserProblem] = useState<string | undefined>();
  const [browserBusy, setBrowserBusy] = useState(false);
  const [engine, setEngine] = useState<SttEngine | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [canBrowser, setCanBrowser] = useState(false);
  const recordingRef = useRef<Recording | null>(null);
  const browserRef = useRef<BrowserListening | undefined>(undefined);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    setCanBrowser(browserSpeechSupported());
    fetch("/api/health", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((health) => setVoiceReady(voiceModeFrom(health) === "aethex"))
      .catch(() => setVoiceReady(false));
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  async function transcribe(wav: ArrayBuffer): Promise<string | undefined> {
    const form = new FormData();
    form.set("audio", new Blob([wav], { type: "audio/wav" }), "voix.wav");
    try {
      const res = await fetch("/api/stt-test", { method: "POST", body: form, cache: "no-store" });
      if (!res.ok) return undefined;
      return ((await res.json()) as { text?: string }).text ?? "";
    } catch {
      return undefined;
    }
  }

  const takesOf = (list: Result[]) =>
    list.filter((r) => r.heard !== undefined).map((r) => ({ profile: r.profile, heard: r.heard as string, saturated: r.saturated === true }));

  async function run() {
    setResults([]);
    setChosen(undefined);
    setBrowserHeard(undefined);
    setBrowserProblem(undefined);
    setEngine(undefined);
    setNotice(undefined);
    const done: Result[] = [];
    for (const [i, profile] of PROFILES.entries()) {
      setIndex(i);
      if (i > 0) await sleep(1500);
      const result: Result = { profile };
      try {
        const recording = await startRecording(profile);
        recordingRef.current = recording;
        setStep("listening");
        const heard = await recording.result;
        recordingRef.current = null;
        if (!heard) {
          result.problem = "Rien entendu : parle juste après le début de l'essai.";
        } else {
          const url = URL.createObjectURL(new Blob([heard.wav], { type: "audio/wav" }));
          urls.current.push(url);
          result.url = url;
          result.summary = describeRecording(heard.stats);
          result.saturated = heard.stats.clipped > CLIPPING_LIMIT;
          setStep("sending");
          const text = await transcribe(heard.wav);
          if (text === undefined) result.problem = "La transcription a échoué (AethexAI ne répond pas ?).";
          else result.heard = text;
        }
      } catch (e) {
        recordingRef.current = null;
        result.problem = micErrorMessage((e as { name?: string })?.name, window.isSecureContext);
        done.push(result);
        setResults([...done]);
        break;
      }
      done.push(result);
      setResults([...done]);
    }

    const best = bestProfile(takesOf(done));
    if (best) {
      saveMicProfile(best);
      saveSttEngine("aethex");
      setChosen(best);
      setEngine("aethex");
    } else {
      setNotice("Aucun réglage n'a donné un texte utile. Rapproche le micro, parle un peu plus fort, ou essaie dans un endroit plus calme.");
    }
    setStep("done");
  }

  /** Essai facultatif : la reconnaissance du navigateur comprend-elle mieux cette voix ? Lancé par un clic (geste requis). */
  async function tryBrowser() {
    setBrowserBusy(true);
    setBrowserProblem(undefined);
    const listening = recognizeOnce();
    browserRef.current = listening;
    if (!listening) {
      setBrowserProblem("Ce navigateur n'a pas de reconnaissance vocale.");
      setBrowserBusy(false);
      return;
    }
    const { text, error } = await listening.result;
    browserRef.current = undefined;
    setBrowserBusy(false);
    if (!text.trim()) {
      setBrowserHeard(undefined);
      setBrowserProblem(error === "not-allowed" ? "Autorise le micro dans ton navigateur." : "Rien entendu : réessaie.");
      return;
    }
    setBrowserHeard(text.trim());
    const picked = chooseEngine(takesOf(results), text.trim());
    saveSttEngine(picked);
    setEngine(picked);
  }

  const running = step === "listening" || step === "sending";
  const total = PROFILES.length;

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.tile} aria-hidden="true">J</div>
        <div>
          <h1 className={styles.title}>Test du micro</h1>
          <p className={styles.sub}>Trouve le réglage que la reconnaissance vocale comprend le mieux</p>
        </div>
      </header>

      {voiceReady === false && (
        <p className={styles.notice} role="alert">La voix AethexAI n'est pas configurée sur ce serveur : ce test ne peut pas se faire.</p>
      )}

      <MicCheck />

      <section className={styles.thread} aria-live="polite">
        <p className={`${styles.bubble} ${styles.agent}`}>
          {total} essais d'affilée. À chaque essai, dis la même phrase, calmement et à environ 20 cm du micro :{" "}
          <strong>« {EXPECTED_PHRASE} »</strong>. L'essai s'arrête tout seul quand tu te tais.
        </p>

        {results.map((r) => {
          const score = r.heard !== undefined ? phraseScore(r.heard) : undefined;
          return (
            <div key={r.profile} className={`${styles.bubble} ${styles.agent}`}>
              <strong>{MIC_PROFILES[r.profile].label}</strong>
              {r.problem && <span className={styles.source}>{r.problem}</span>}
              {r.heard !== undefined && (
                <span style={{ display: "block", marginTop: 6 }}>
                  Compris : « {r.heard || "(rien)"} » {score !== undefined && <em>({scoreLabel(score)})</em>}
                </span>
              )}
              {r.summary && <span className={styles.source} style={r.saturated ? { fontWeight: 700 } : undefined}>{r.summary}</span>}
              {r.url && <audio controls src={r.url} style={{ width: "100%", marginTop: 6 }} />}
              {chosen === r.profile && engine === "aethex" && <span className={styles.source}><strong>Réglage retenu pour cet appareil.</strong></span>}
            </div>
          );
        })}

        {browserHeard !== undefined && (
          <div className={`${styles.bubble} ${styles.agent}`}>
            <strong>Reconnaissance du navigateur</strong>
            <span style={{ display: "block", marginTop: 6 }}>
              Compris : « {browserHeard} » <em>({scoreLabel(phraseScore(browserHeard))})</em>
            </span>
            {engine === "navigateur" && <span className={styles.source}><strong>Moteur retenu pour cet appareil.</strong></span>}
          </div>
        )}
        {browserProblem && <p className={`${styles.bubble} ${styles.agent}`}>{browserProblem}</p>}

        {running && (
          <p className={`${styles.bubble} ${styles.visitor}`}>
            {step === "listening" ? `Essai ${index + 1} sur ${total} : parle maintenant.` : `Essai ${index + 1} sur ${total} : envoi en cours…`}
          </p>
        )}
        {browserBusy && <p className={`${styles.bubble} ${styles.visitor}`}>Parle maintenant : le navigateur t'écoute.</p>}

        {step === "done" && engine === "aethex" && chosen && (
          <p className={`${styles.bubble} ${styles.agent}`}>
            C'est réglé : les pages <strong>/</strong> et <strong>/prospect</strong> utiliseront AethexAI avec « {MIC_PROFILES[chosen].label} » sur
            cet appareil. Tu peux recommencer à tout moment.
          </p>
        )}
        {step === "done" && engine === "navigateur" && (
          <p className={`${styles.bubble} ${styles.agent}`}>
            C'est réglé : sur cet appareil, <strong>le navigateur écoute</strong> (il t'a mieux compris qu'AethexAI) et AethexAI continue de
            parler. Tu peux recommencer à tout moment.
          </p>
        )}
      </section>

      {notice && <p className={styles.notice} role="alert">{notice}</p>}

      <div className={styles.form}>
        <button type="button" className={styles.send} style={{ flex: 1 }} disabled={running || browserBusy || voiceReady !== true} onClick={() => void run()}>
          {step === "idle" ? `Lancer le test (${total} essais)` : running ? "Test en cours…" : "Recommencer"}
        </button>
        {step === "listening" && (
          <button type="button" className={styles.send} onClick={() => recordingRef.current?.stop()}>Arrêter l'essai</button>
        )}
      </div>

      {step === "done" && canBrowser && (
        <div className={styles.form}>
          <button type="button" className={styles.send} style={{ flex: 1 }} disabled={browserBusy} onClick={() => void tryBrowser()}>
            {browserBusy ? "Le navigateur écoute…" : "Essayer aussi la reconnaissance du navigateur"}
          </button>
          {browserBusy && <button type="button" className={styles.send} onClick={() => browserRef.current?.stop()}>Arrêter</button>}
        </div>
      )}

      <p className={styles.footer}>
        Chaque essai est envoyé à AethexAI pour être transcrit ; ce serveur ne garde pas le son. L'essai du navigateur est traité par le
        service de reconnaissance de ton navigateur.
      </p>
    </main>
  );
}
