"use client";

// L'historique de la commerçante : ses opérations et leur statut. Une opération bloquée par Argus se débloque ici, en
// vérifiant son identité (KYC statique). Le déblocage ne fait rien partir : il ramène à la relecture, avec Oui et Non.

import { useCallback, useEffect, useState } from "react";
import { WALLET_LABEL } from "../../lib/intent";
import type { HistoryItem } from "../../lib/history";
import { formatXof } from "../../lib/text";
import styles from "./marchand.module.css";
import type { TurnView } from "./view";

interface Props {
  sessionId: string;
  /** Change à chaque réponse de l'assistant : l'historique se recharge alors. */
  refreshKey: unknown;
  busy: boolean;
  /** Reçoit la relecture quand l'identité est vérifiée. */
  onUnblocked: (view: TurnView) => void;
  unlockAudio: () => void;
}

const BADGE: Record<HistoryItem["state"], string> = {
  done: styles.badgeDone,
  waiting: styles.badgeWaiting,
  to_confirm: styles.badgeWaiting,
  cancelled: styles.badgeMuted,
  blocked: styles.badgeBlocked,
  failed: styles.badgeBlocked,
};

const hour = (ts: number) =>
  new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function title(item: HistoryItem): string {
  if (item.kind === "send") return `Envoi à ${item.who ?? "un numéro"}`;
  return item.wallet ? `Encaissement ${WALLET_LABEL[item.wallet]}` : "Encaissement";
}

export default function History({ sessionId, refreshKey, busy, onUnblocked, unlockAudio }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [hint, setHint] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | undefined>();
  const [birthDate, setBirthDate] = useState("");
  const [idLast4, setIdLast4] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/history", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: HistoryItem[]; kycHint?: string };
      setItems(data.items ?? []);
      setHint(data.kycHint);
    } catch {
      /* hors ligne : on garde la liste précédente */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function open(id: string) {
    setOpenId(openId === id ? undefined : id);
    setBirthDate("");
    setIdLast4("");
    setError(undefined);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!openId || working || !sessionId) return;
    unlockAudio();
    setWorking(true);
    setError(undefined);
    try {
      const res = await fetch("/api/unblock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, operationId: openId, birthDate, idLast4 }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as TurnView & { message?: string };
      if (res.ok && data.reply) {
        setOpenId(undefined);
        onUnblocked(data);
        return;
      }
      setError(data.message ?? "Je n'ai pas pu vérifier. Réessaie.");
      if (res.status === 423) void load();
    } catch {
      setError("Je n'ai pas pu vérifier. Réessaie.");
    } finally {
      setWorking(false);
    }
  }

  if (!items.length) return null;

  return (
    <section className={styles.history} aria-label="Historique">
      <h2 className={styles.historyTitle}>Historique</h2>
      <ul className={styles.historyList}>
        {items.map((item) => (
          <li key={item.id} className={styles.historyRow}>
            <div className={styles.historyLine}>
              <div>
                <p className={styles.historyWhat}>{title(item)}</p>
                <p className={styles.historyMeta}>{hour(item.ts)}</p>
              </div>
              <div className={styles.historyEnd}>
                <p className={styles.historyAmount}>{formatXof(item.amount)} F</p>
                <span className={`${styles.badge} ${BADGE[item.state]}`}>{item.label}</span>
              </div>
            </div>

            {item.state === "blocked" && item.unlockable && (
              <button type="button" className={styles.unlockBtn} disabled={busy} onClick={() => open(item.id)} aria-expanded={openId === item.id}>
                Débloquer
              </button>
            )}
            {item.state === "blocked" && !item.unlockable && (
              <p className={styles.historyMeta}>Trop d&apos;essais. Un conseiller Jèko va te rappeler.</p>
            )}

            {openId === item.id && (
              <form className={styles.kycForm} onSubmit={submit}>
                <p className={styles.kycIntro}>Pour débloquer, vérifie ton identité.</p>
                <label className={styles.kycLabel}>
                  Date de naissance
                  <input
                    className={styles.input}
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    placeholder="JJ/MM/AAAA"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={10}
                  />
                </label>
                <label className={styles.kycLabel}>
                  4 derniers chiffres de ta pièce d&apos;identité
                  <input
                    className={styles.input}
                    value={idLast4}
                    onChange={(e) => setIdLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="0000"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                  />
                </label>
                {hint && <p className={styles.kycHint}>Démonstration : {hint}</p>}
                {error && <p className={styles.notice} role="alert">{error}</p>}
                <button type="submit" className={styles.send} disabled={working || !birthDate.trim() || idLast4.length !== 4}>
                  Vérifier
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
