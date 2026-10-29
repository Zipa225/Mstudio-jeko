"use client";

import { useEffect, useRef, useState } from "react";
import { MIC_PROFILES, saveMicProfile, startRecording, type MicProfile, type Recording } from "../marchand/audio";
import { describeRecording, micErrorMessage, voiceModeFrom } from "../marchand/view";
import styles from "../prospect/prospect.module.css";
import { bestProfile, EXPECTED_PHRASE, phraseScore, scoreLabel } from "./score";

const PROFILES: MicProfile[] = ["standard", "sans_reduction", "brut"];

interface Result {
  profile: MicProfile;
  heard?: string;
  summary?: string;
  url?: string;
  problem?: string;
}

type Step = "idle" | "listening" | "sending" | "done";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function MicroPage() {
  const [voiceReady, setVoiceReady] = useState<boolean | undefined>();
  const [step, setStep] = useState<Step>("idle");
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [chosen, setChosen] = useState<MicProfile | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const recordingRef = useRef<Recording | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
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

  async function run() {
    setResults([]);
    setChosen(undefined);
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

    const best = bestProfile(done.filter((r) => r.heard !== undefined).map((r) => ({ profile: r.profile, heard: r.heard as string })));
    if (best) {
      saveMicProfile(best);
      setChosen(best);
    } else {
      setNotice("Aucun réglage n'a donné un texte utile. Rapproche le micro, parle un peu plus fort, ou essaie dans un endroit plus calme.");
    }
    setStep("done");
  }

  const running = step === "listening" || step === "sending";

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

      <section className={styles.thread} aria-live="polite">
        <p className={`${styles.bubble} ${styles.agent}`}>
          Trois essais d'affilée. À chaque essai, dis la même phrase, calmement : <strong>« {EXPECTED_PHRASE} »</strong>. L'essai
          s'arrête tout seul quand tu te tais.
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
              {r.summary && <span className={styles.source}>{r.summary}</span>}
              {r.url && <audio controls src={r.url} style={{ width: "100%", marginTop: 6 }} />}
              {chosen === r.profile && <span className={styles.source}><strong>Réglage retenu pour cet appareil.</strong></span>}
            </div>
          );
        })}

        {running && (
          <p className={`${styles.bubble} ${styles.visitor}`}>
            {step === "listening" ? `Essai ${index + 1} sur 3 : parle maintenant.` : `Essai ${index + 1} sur 3 : envoi en cours…`}
          </p>
        )}

        {step === "done" && chosen && (
          <p className={`${styles.bubble} ${styles.agent}`}>
            C'est réglé : les pages <strong>/</strong> et <strong>/prospect</strong> utiliseront « {MIC_PROFILES[chosen].label} » sur cet
            appareil. Tu peux recommencer à tout moment.
          </p>
        )}
      </section>

      {notice && <p className={styles.notice} role="alert">{notice}</p>}

      <div className={styles.form}>
        <button type="button" className={styles.send} style={{ flex: 1 }} disabled={running || voiceReady !== true} onClick={() => void run()}>
          {step === "idle" ? "Lancer le test (3 essais)" : running ? "Test en cours…" : "Recommencer"}
        </button>
        {step === "listening" && (
          <button type="button" className={styles.send} onClick={() => recordingRef.current?.stop()}>Arrêter l'essai</button>
        )}
      </div>

      <p className={styles.footer}>Chaque essai est envoyé à AethexAI pour être transcrit ; ce serveur ne garde pas le son.</p>
    </main>
  );
}
