"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LEVEL_MESSAGE, levelVerdict, openMic, rmsOf, saveMicDevice, savedMicDevice, savedMicProfile, type LevelVerdict } from "../marchand/audio";
import { micErrorMessage } from "../marchand/view";
import styles from "../prospect/prospect.module.css";

interface Device {
  id: string;
  label: string;
}

/**
 * Étape « Vérifier mon micro » : liste les micros de l'appareil, montre une barre de niveau en direct et dit si le micro choisi
 * capte la voix. Sert quand « rien ne sort » : souvent le navigateur n'écoute pas le micro des écouteurs ou du casque branché.
 */
export default function MicCheck() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [verdict, setVerdict] = useState<LevelVerdict>("attente");
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => {
    setSaved(savedMicDevice());
    return () => stop.current();
  }, []);

  const start = useCallback(async (deviceId: string) => {
    stop.current();
    setProblem(undefined);
    setLevel(0);
    setVerdict("attente");
    try {
      const stream = await openMic(savedMicProfile(), deviceId || undefined);
      // Les noms des micros ne sont donnés qu'après l'autorisation du micro.
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Micro ${i + 1}` })));
      const used = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (!deviceId && used) setSelected(used);

      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtor();
      if (context.state === "suspended") await context.resume().catch(() => undefined);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const began = performance.now();
      let peak = 0;
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        peak = Math.max(peak, ...samples.map(Math.abs));
        setLevel(rmsOf(samples));
        setVerdict(levelVerdict(peak, performance.now() - began));
      }, 100);
      stop.current = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
        stop.current = () => undefined;
        setActive(false);
      };
      setActive(true);
    } catch (e) {
      setActive(false);
      setProblem(micErrorMessage((e as { name?: string })?.name, window.isSecureContext));
    }
  }, []);

  function choose(id: string) {
    setSelected(id);
    void start(id);
  }

  function useThisMic() {
    saveMicDevice(selected || undefined);
    setSaved(selected || undefined);
  }

  const bar = Math.min(100, Math.round(level * 500));
  const chosenLabel = devices.find((d) => d.id === saved)?.label;

  return (
    <div className={`${styles.bubble} ${styles.agent}`} style={{ maxWidth: "100%" }}>
      <strong>Étape 1 : vérifier que ton micro capte ta voix</strong>
      <span className={styles.source} style={{ marginTop: 4 }}>
        Si rien ne sort avec les écouteurs ou le casque, le navigateur n'écoute peut-être pas leur micro.
      </span>

      {!active && (
        <button type="button" className={styles.send} style={{ marginTop: 8, width: "100%" }} onClick={() => void start(selected)}>
          {devices.length ? "Relancer l'écoute du micro" : "Écouter mon micro"}
        </button>
      )}
      {active && (
        <button type="button" className={styles.send} style={{ marginTop: 8, width: "100%" }} onClick={() => stop.current()}>
          Arrêter
        </button>
      )}

      {problem && <span className={styles.source}>{problem}</span>}

      {devices.length > 0 && (
        <label style={{ display: "block", marginTop: 10, fontSize: 15 }}>
          Micro utilisé
          <select
            value={selected}
            onChange={(e) => choose(e.target.value)}
            style={{ display: "block", width: "100%", minHeight: 44, marginTop: 4, fontSize: 16, fontFamily: "inherit" }}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
      )}

      {active && (
        <>
          <div style={{ marginTop: 10, height: 18, borderRadius: 9, background: "var(--bordure-claire)", overflow: "hidden" }} aria-hidden="true">
            <div style={{ width: `${bar}%`, height: "100%", background: verdict === "sature" ? "var(--jeko-violet-actif)" : "var(--jeko-violet)", transition: "width 0.1s" }} />
          </div>
          <span style={{ display: "block", marginTop: 6 }} role="status">
            <strong>{LEVEL_MESSAGE[verdict]}</strong>
          </span>
        </>
      )}

      {devices.length > 0 && (
        <button type="button" className={styles.send} style={{ marginTop: 10, width: "100%" }} onClick={useThisMic} disabled={!selected && !saved}>
          Utiliser ce micro pour l'application
        </button>
      )}
      {saved !== undefined && (
        <span className={styles.source}>
          Micro enregistré sur cet appareil{chosenLabel ? ` : ${chosenLabel}` : ""}.{" "}
          <button type="button" onClick={() => { saveMicDevice(undefined); setSaved(undefined); }} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>
            Revenir au micro du système
          </button>
        </span>
      )}
    </div>
  );
}
