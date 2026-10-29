// Qualification de prospects (F12, RG-24) : un visiteur parle à l'assistant, qui pose quatre questions (activité, volume,
// moyens de paiement, ville) puis demande s'il veut être rappelé. Une fiche est tenue à jour pour l'écran de l'analyste.
//
// RÈGLE « chaud, tiède, froid » (écrite ici, testée, et reprise dans le README) :
//   chaud : au moins 3 réponses sur 4 ET le visiteur demande à être rappelé par un conseiller ;
//   tiède : au moins 2 réponses (sans les deux conditions du chaud) ;
//   froid : moins de 2 réponses.
// Une « réponse » est une question à laquelle le visiteur a vraiment répondu : « je ne sais pas » ou « passe » ne comptent pas.
//
// Limites assumées : aucune coordonnée (téléphone, nom) n'est collectée : c'est un prototype, et demander un contact
// supposerait un consentement explicite. Le visiteur peut poser des questions de support : la base répond avec sa source.

import { parseAmount } from "./frenchNumbers";
import { isNo, isYes, parseIntent } from "./intent";
import { findAnswer, summarize } from "./kb";
import type { LeadInterest, Store } from "./store";
import { formatXof, normalize } from "./text";

export type ProspectStage = "activity" | "volume" | "payments" | "city" | "call" | "done";

export interface ProspectReply {
  reply: string;
  speech: string;
  /** Source de la réponse, si le visiteur a posé une question de support. */
  source?: string;
  stage: ProspectStage;
  interest: LeadInterest;
}

interface Answers {
  activity?: string;
  volume?: string;
  payments?: string;
  city?: string;
  wantsCall?: boolean;
  question?: string;
}

interface State {
  stage: ProspectStage;
  answers: Answers;
  /** Le prospect est déjà passé « chaud » : on n'alerte l'analyste qu'une fois. */
  hotAlerted: boolean;
}

const MAX_SESSIONS = 200;
const MAX_FIELD = 80;

export const QUESTION_COUNT = 4;

/** Combien des quatre questions ont reçu une vraie réponse. */
export const answerCount = (a: Pick<Answers, "activity" | "volume" | "payments" | "city">): number =>
  [a.activity, a.volume, a.payments, a.city].filter((v) => v !== undefined).length;

/** La règle chaud, tiède, froid. */
export function qualify(a: Answers): LeadInterest {
  const n = answerCount(a);
  if (n >= 3 && a.wantsCall === true) return "chaud";
  if (n >= 2) return "tiede";
  return "froid";
}

export function leadSummary(a: Answers): string {
  const parts: string[] = [];
  if (a.activity) parts.push(`Activité : ${a.activity}.`);
  if (a.volume) parts.push(`Volume : ${a.volume}.`);
  if (a.payments) parts.push(`Moyens de paiement : ${a.payments}.`);
  if (a.city) parts.push(`Ville : ${a.city}.`);
  if (a.wantsCall === true) parts.push("Veut être rappelé par un conseiller.");
  if (a.wantsCall === false) parts.push("Ne veut pas être rappelé.");
  if (a.question) parts.push(`Question sans réponse : « ${a.question} ».`);
  return parts.length ? parts.join(" ") : "Aucune réponse pour le moment.";
}

// ---------------------------------------------------------------------------
// Lecture des réponses
// ---------------------------------------------------------------------------

const clip = (s: string, max = MAX_FIELD) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const stripEnds = (s: string) => s.trim().replace(/^[\s.,;:!?«»"'’-]+|[\s.,;:!?«»"'’-]+$/g, "");

/** « je ne sais pas », « passe » : le visiteur saute la question. */
export function isSkip(text: string): boolean {
  const n = normalize(text);
  if (!n) return true;
  if (/\b(je ne sais pas|sais pas|aucune idee|prefere ne pas|ne veux pas (repondre|dire)|pas envie|sans reponse)\b/.test(n)) return true;
  return n.split(" ").length <= 3 && /\b(passe|passer|suivant|non merci|rien)\b/.test(n);
}

export function cleanActivity(text: string): string | undefined {
  let t = stripEnds(text);
  t = t.replace(/^(?:moi\s+)?je\s+(?:vends?|suis|fais|tiens|travaille\s+dans|travaille)\s+/i, "");
  t = t.replace(/^(?:un|une|des|du|de la|de l['’]|le|la|les)\s+/i, "");
  t = stripEnds(t);
  return t.length >= 2 ? clip(capitalize(t)) : undefined;
}

export function parseVolume(text: string): string | undefined {
  const n = normalize(text);
  const amount = parseAmount(text);
  if (amount !== undefined) {
    const period = /\b(jour|jours|quotidien|quotidienne)\b/.test(n)
      ? "par jour"
      : /\bsemaine\b/.test(n) ? "par semaine" : /\bans?\b|\bannee\b/.test(n) ? "par an" : "par mois";
    return `${formatXof(amount)} FCFA ${period}`;
  }
  const t = stripEnds(text);
  return t.length >= 3 ? clip(capitalize(t), 60) : undefined;
}

const PAYMENT_LABELS: Array<[string, string]> = [
  ["wave", "Wave"], ["orange", "Orange Money"], ["mtn", "MTN"], ["moov", "Moov"], ["djamo", "Djamo"],
  ["especes", "espèces"], ["cash", "espèces"], ["liquide", "espèces"], ["carte", "carte"], ["visa", "carte"],
];

export function parsePayments(text: string): string | undefined {
  const words = normalize(text).split(" ");
  const found: string[] = [];
  for (const [key, label] of PAYMENT_LABELS) if (words.includes(key) && !found.includes(label)) found.push(label);
  if (found.length) return found.join(", ");
  const t = stripEnds(text);
  return t.length >= 3 ? clip(capitalize(t), 60) : undefined;
}

const CITIES: Array<[string, string]> = [
  ["abidjan", "Abidjan"], ["bouake", "Bouaké"], ["yamoussoukro", "Yamoussoukro"], ["san pedro", "San-Pédro"], ["korhogo", "Korhogo"],
  ["daloa", "Daloa"], ["gagnoa", "Gagnoa"], ["divo", "Divo"], ["abengourou", "Abengourou"], ["bondoukou", "Bondoukou"],
  ["odienne", "Odienné"], ["ferkessedougou", "Ferkessédougou"], ["soubre", "Soubré"], ["agboville", "Agboville"], ["dabou", "Dabou"],
  ["grand bassam", "Grand-Bassam"], ["anyama", "Anyama"], ["adzope", "Adzopé"], ["aboisso", "Aboisso"], ["man", "Man"],
];

export function parseCity(text: string): string | undefined {
  const n = ` ${normalize(text)} `;
  for (const [key, label] of CITIES) if (n.includes(` ${key} `)) return label;
  const t = stripEnds(text).replace(/^(?:moi\s+)?(?:je\s+suis|j['’]habite|j['’]suis|je\s+vis|je\s+travaille|on\s+est)?\s*(?:à|a|en|dans|au|sur)\s+/i, "");
  const city = stripEnds(t);
  return /\p{L}{3}/u.test(city) ? clip(capitalize(city), 40) : undefined;
}

// ---------------------------------------------------------------------------
// L'agent
// ---------------------------------------------------------------------------

const QUESTION: Record<Exclude<ProspectStage, "done">, string> = {
  activity: "Que vends-tu, ou quelle est ton activité ?",
  volume: "Combien d'argent encaisses-tu à peu près par mois ?",
  payments: "Quels moyens de paiement tes clients utilisent-ils aujourd'hui ? Par exemple Wave, Orange, MTN, Moov ou les espèces.",
  city: "Dans quelle ville travailles-tu ?",
  call: "Veux-tu qu'un conseiller Jèko te rappelle pour t'inscrire ?",
};

const ORDER: ProspectStage[] = ["activity", "volume", "payments", "city", "call", "done"];
const next = (stage: ProspectStage): ProspectStage => ORDER[Math.min(ORDER.indexOf(stage) + 1, ORDER.length - 1)];

export const GREETING = "Bonjour ! Je suis l'assistant de Jèko. Quatre petites questions pour mieux te conseiller.";
const DONE_YES = "Parfait, c'est noté. Un conseiller Jèko va te rappeler.";
const DONE_NO = "D'accord, pas de souci. Si tu changes d'avis, pose-moi une question ou joins Jèko du lundi au vendredi, de 8 h à 18 h.";
const DONE_MORE = "C'est noté. Tu as une autre question sur Jèko ?";
const NOT_UNDERSTOOD = "Je n'ai pas bien compris.";

export interface ProspectAgent {
  handleTurn(sessionId: string, text: string): ProspectReply;
}

export function createProspectAgent(deps: { store: Store }): ProspectAgent {
  const { store } = deps;
  const states = new Map<string, State>();

  /** Met la fiche du prospect à jour (dès qu'il a dit quelque chose) et prévient l'analyste la première fois qu'il devient chaud. */
  function sync(sessionId: string, s: State): LeadInterest {
    const interest = qualify(s.answers);
    const touched = answerCount(s.answers) > 0 || s.answers.question !== undefined || s.answers.wantsCall !== undefined;
    if (touched) {
      const lead = store.upsertLead(sessionId, { ...s.answers, interest, summary: leadSummary(s.answers) });
      if (interest === "chaud" && !s.hotAlerted) {
        s.hotAlerted = true;
        store.addAlert({ level: "info", type: "lead", title: "Prospect chaud", detail: lead.summary });
      }
    }
    return interest;
  }

  const reply = (s: State, interest: LeadInterest, lines: string[], source?: string): ProspectReply => {
    const text = lines.join(" ");
    return { reply: text, speech: text, stage: s.stage, interest, ...(source ? { source } : {}) };
  };

  /** Une question de support posée en cours de route : réponse sourcée, ou passage à un conseiller. */
  function support(s: State, question: string): { line: string; source?: string } {
    const found = findAnswer(question);
    if (found && !found.entry.handoff) return { line: found.entry.speech, source: found.entry.source };
    s.answers.question = summarize(question, MAX_FIELD);
    store.addAlert({
      level: "info", type: "handoff", title: "Question passée à un conseiller",
      detail: `Un prospect a demandé : « ${summarize(question)} ». ${found ? `Réponse partielle donnée (${found.entry.id}).` : "Hors de la base du support."} Un conseiller doit lui répondre.`,
    });
    if (found) return { line: found.entry.speech, source: found.entry.source };
    return { line: "Je n'ai pas la réponse à ça. Je passe ta question à un conseiller Jèko, qui te répondra." };
  }

  return {
    handleTurn(sessionId: string, rawText: string): ProspectReply {
      const text = rawText.trim();
      const skipped = isSkip(text);
      const isQuestion = !skipped && parseIntent(text).kind === "support";
      let s = states.get(sessionId);

      // Première prise de contact : on accueille et on pose la première question.
      if (!s) {
        s = { stage: "activity", answers: {}, hotAlerted: false };
        states.set(sessionId, s);
        if (states.size > MAX_SESSIONS) states.delete(states.keys().next().value as string);
        const asked = isQuestion ? support(s, text) : undefined;
        const interest = sync(sessionId, s);
        return reply(s, interest, [...(asked ? [asked.line] : []), GREETING, QUESTION.activity], asked?.source);
      }

      // Une question de support passe avant tout, sans faire avancer l'entretien.
      if (isQuestion) {
        const asked = support(s, text);
        const interest = sync(sessionId, s);
        return reply(s, interest, [asked.line, s.stage === "done" ? DONE_MORE : QUESTION[s.stage]], asked.source);
      }

      if (s.stage === "done") return reply(s, qualify(s.answers), [DONE_MORE]);
      if (!text) return reply(s, qualify(s.answers), [QUESTION[s.stage]]);

      if (s.stage === "call") {
        if (isYes(text)) s.answers.wantsCall = true;
        else if (isNo(text)) s.answers.wantsCall = false;
        else return reply(s, qualify(s.answers), ["Dis oui si tu veux être rappelé, ou non."]);
        s.stage = "done";
        const interest = sync(sessionId, s);
        return reply(s, interest, [s.answers.wantsCall ? DONE_YES : DONE_NO]);
      }

      if (!skipped) {
        switch (s.stage) {
          case "activity": s.answers.activity = cleanActivity(text); break;
          case "volume": s.answers.volume = parseVolume(text); break;
          case "payments": s.answers.payments = parsePayments(text); break;
          case "city": s.answers.city = parseCity(text); break;
        }
        if (s.answers[s.stage] === undefined) return reply(s, qualify(s.answers), [NOT_UNDERSTOOD, QUESTION[s.stage]]);
      }
      s.stage = next(s.stage);
      const interest = sync(sessionId, s);
      return reply(s, interest, [skipped ? "Pas de souci." : "Merci.", QUESTION[s.stage as Exclude<ProspectStage, "done">]]);
    },
  };
}
