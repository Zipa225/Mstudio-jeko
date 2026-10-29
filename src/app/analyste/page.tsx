"use client";

import { useEffect, useRef, useState } from "react";
import { formatXof } from "../../lib/text";
import styles from "./analyste.module.css";
import {
  ALERT_TONE_LABEL, alertTone, counters, DECISION_LABEL, duressNotice, factorChip, formatClock, INTEREST_LABEL, INTEREST_TONE,
  KIND_LABEL, operationTarget, pickBanner, sortLeads, STATUS_LABEL, STATUS_TONE, type AnalystState,
} from "./view";

const POLL_MS = 1200;
/** Sur le grand écran, on garde l'essentiel : les éléments les plus récents. */
const MAX_ALERTS = 5;
const MAX_OPERATIONS = 8;
const MAX_LEADS = 6;

function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function Shield() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
    </svg>
  );
}

export default function AnalystePage() {
  const [state, setState] = useState<AnalystState | null>(null);
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [resetStep, setResetStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [resetError, setResetError] = useState<string | undefined>();
  const failures = useRef(0);

  // Mise à jour automatique toutes les 1,2 seconde, sans empiler les requêtes.
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const ctrl = new AbortController();

    async function tick() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/state", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as AnalystState;
        if (!stopped) {
          setState(data);
          failures.current = 0;
          setOffline(false);
        }
      } catch {
        if (!stopped && !ctrl.signal.aborted) {
          failures.current += 1;
          if (failures.current >= 3) setOffline(true);
        }
      } finally {
        inFlight = false;
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, []);

  // La confirmation de remise à zéro expire seule.
  useEffect(() => {
    if (resetStep !== "confirm") return;
    const id = setTimeout(() => setResetStep("idle"), 4000);
    return () => clearTimeout(id);
  }, [resetStep]);

  async function onReset() {
    if (resetStep === "idle") {
      setResetError(undefined);
      setResetStep("confirm");
      return;
    }
    if (resetStep !== "confirm") return;
    setResetStep("busy");
    try {
      const res = await fetch("/api/reset", { method: "POST", cache: "no-store" });
      if (res.ok) setDismissed(new Set());
      else setResetError(res.status === 403 ? "Remise à zéro désactivée hors mode démonstration." : "La remise à zéro a échoué.");
    } catch {
      setResetError("La remise à zéro a échoué.");
    } finally {
      setResetStep("idle");
    }
  }

  if (!state) {
    return (
      <main className={styles.screen}>
        <p className={styles.skeleton} role="status">{offline ? "Connexion impossible, nouvelle tentative…" : "Chargement…"}</p>
      </main>
    );
  }

  const banner = pickBanner(state.alerts, dismissed);
  const notice = duressNotice(state.duress);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden="true">J</div>
          <div>
            <h1 className={styles.title}>Jèko Voix : analyste</h1>
            <p className={styles.subtitle}>
              {state.merchant.name} · {state.merchant.shop} · prototype hackathon
            </p>
          </div>
        </div>
        <div className={styles.status} role="status">
          <span>
            <span className={`${styles.dot} ${offline ? styles.dotOff : ""}`} aria-hidden="true" />
            {offline ? "Connexion perdue, nouvelle tentative…" : "En direct"}
          </span>
          <span>Heure d&apos;Abidjan {formatClock(state.now)}</span>
        </div>
      </header>

      {notice && <p className={styles.notice} role="alert">{notice}</p>}

      {banner && (
        <section key={banner.id} className={styles.banner} role="alert" aria-live="assertive">
          <div className={styles.bannerTop}>
            <h2 className={styles.bannerTitle}>
              <Shield />
              {banner.title}
            </h2>
            {banner.score !== undefined && <div className={styles.bannerScore}>Score {banner.score} / 100</div>}
          </div>
          <p className={styles.bannerDetail}>{banner.detail}</p>
          {banner.factors && banner.factors.length > 0 && (
            <ul className={styles.reasons} aria-label="Raisons du score">
              {banner.factors.map((f) => (
                <li key={f.id} className={styles.reason}>{factorChip(f)}</li>
              ))}
            </ul>
          )}
          <button type="button" className={styles.dismiss} onClick={() => setDismissed((prev) => new Set(prev).add(banner.id))}>
            J&apos;ai vu
          </button>
        </section>
      )}

      <section className={styles.counters} aria-label="Compteurs">
        {counters(state).map((c) => (
          <div key={c.id} className={`${styles.counter} ${c.highlight ? styles.counterHot : ""}`}>
            <div className={styles.counterValue}>{c.value}</div>
            <div className={styles.counterLabel}>{c.label}</div>
          </div>
        ))}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="alertes">
          <h2 id="alertes" className={styles.panelTitle}>Dernières alertes</h2>
          {state.alerts.length === 0 ? (
            <p className={styles.empty}>Aucune alerte pour le moment.</p>
          ) : (
            <ul className={styles.alerts}>
              {state.alerts.slice(0, MAX_ALERTS).map((a) => {
                const tone = alertTone(a);
                return (
                  <li
                    key={a.id}
                    className={`${styles.alert} ${tone === "critical" ? styles.alertCritical : tone === "warning" ? styles.alertWarning : ""}`}
                  >
                    <div className={styles.alertHead}>
                      <span className={`${styles.tag} ${tone === "warning" ? styles.tagWarning : ""}`}>{ALERT_TONE_LABEL[tone]}</span>
                      <span className={styles.alertTitle}>{a.title}</span>
                      <span className={styles.time}>{formatClock(a.ts)}</span>
                    </div>
                    <p className={styles.alertDetail}>{a.detail}</p>
                    {a.factors && a.factors.length > 0 && (
                      <ul className={styles.chips} aria-label="Raisons du score">
                        {a.factors.map((f) => (
                          <li key={f.id} className={styles.chip}>{factorChip(f)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="operations">
          <h2 id="operations" className={styles.panelTitle}>Dernières opérations</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Heure</th>
                  <th scope="col">Type</th>
                  <th scope="col" className={styles.num}>Montant (FCFA)</th>
                  <th scope="col">Vers / par</th>
                  <th scope="col">Score</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {state.operations.slice(0, MAX_OPERATIONS).map((op) => {
                  const tone = STATUS_TONE[op.status];
                  return (
                    <tr key={op.id} className={op.status === "held" ? styles.rowHeld : undefined}>
                      <td>{formatClock(op.ts)}</td>
                      <td>{KIND_LABEL[op.kind]}</td>
                      <td className={styles.num}>{formatXof(op.amount)}</td>
                      <td>{operationTarget(op)}</td>
                      <td>
                        <span className={styles.score}>{op.score}</span>
                        <span className={styles.decision}>{DECISION_LABEL[op.decision]}</span>
                      </td>
                      <td>
                        <span className={`${styles.pill} ${styles[tone]}`}>
                          {tone === "held" && <Lock />}
                          {STATUS_LABEL[op.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className={`${styles.panel} ${styles.leadsPanel}`} aria-labelledby="prospects">
        <h2 id="prospects" className={styles.panelTitle}>Prospects</h2>
        {(state.leads ?? []).length === 0 ? (
          <p className={styles.empty}>Aucun prospect pour le moment. La page /prospect les reçoit.</p>
        ) : (
          <ul className={styles.leads}>
            {sortLeads(state.leads).slice(0, MAX_LEADS).map((l) => (
              <li key={l.id} className={styles.lead}>
                <div className={styles.alertHead}>
                  <span className={`${styles.pill} ${styles[INTEREST_TONE[l.interest]]}`}>{INTEREST_LABEL[l.interest]}</span>
                  <span className={styles.time}>{formatClock(l.updatedAt)}</span>
                </div>
                <p className={styles.alertDetail}>{l.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className={styles.footer}>
        <span>Mise à jour automatique toutes les 1,2 seconde. Score illustratif sur six critères, pas le moteur Argus complet.</span>
        {state.demoMode && (
          <span>
            {resetError && <span className={styles.error}>{resetError} </span>}
            <button
              type="button"
              className={`${styles.reset} ${resetStep === "confirm" ? styles.resetConfirm : ""}`}
              onClick={onReset}
              disabled={resetStep === "busy"}
            >
              {resetStep === "confirm" ? "Confirmer la remise à zéro" : "Réinitialiser la démo"}
            </button>
          </span>
        )}
      </footer>
    </main>
  );
}
