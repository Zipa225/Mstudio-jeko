# Répartition des tâches avec les agents

Complément de `CLAUDE.md`. Ce fichier dit **qui fait quoi** : quel membre du binôme, quel agent, quels fichiers, quelles tâches, dans quel ordre, et comment les morceaux se branchent entre eux.
Lire `CLAUDE.md` d'abord : les étapes (0 à 7), les fonctionnalités (F01 à F12) et les critères de fin y sont définis. Ici, on ne les répète pas, on les attribue.

---

## 1. Vue d'ensemble

| Agent | Origine | Responsable humain | Fonctionnalités | Étapes |
| --- | --- | --- | --- | --- |
| planner | ECC | Les deux | Découpe et suivi | 0 à 7 |
| voix-marchand | À créer | Binôme | F01, F02, F03, F04, F08 | 1, 2, 3 |
| argus-contrainte | À créer | Emmanuel | F05, F06, F07, F09 | 2, 5 |
| caisse-jeko | À créer | Emmanuel | F10 | 4 |
| support-leads | À créer | Les deux | F11, F12 | 6 |
| tdd-guide | ECC | Celui qui touche au code concerné | Tests | 2, 4, 7 |
| security-reviewer | ECC | Les deux | Sécurité | 2, 7 |
| e2e-runner | ECC | Les deux | Scénarios de démo | 2, 7 |

Le responsable humain valide le travail de son agent. Un agent ne déclare jamais une tâche « faite » : c'est le critère de fin de `CLAUDE.md` vérifié qui la clôt.

---

## 2. Règles communes à tous les agents

1. Lire `CLAUDE.md` et ce fichier avant de commencer.
2. **Travailler uniquement dans ses fichiers** (section 3). Pour toucher à un fichier d'un autre agent, le dire d'abord à l'humain, qui prévient l'autre membre.
3. Une tâche = un petit commit sur la branche de son responsable.
4. Avant de rendre la main : `npm test` et `npm run typecheck` passent.
5. Terminer par un rapport court : ce qui a été fait, ce qui a été **vérifié** (et comment), ce qui reste ou bloque. Rien d'inventé.
6. Jamais de clé API, de `.env.local` ni de vraie phrase secrète dans git, dans un test, dans un log ou dans une capture.
7. Ne pas élargir le périmètre (section 2 de `CLAUDE.md`).
8. Texte en français, sans tirets longs.

---

## 3. Les agents et leurs fichiers

Chaque fichier appartient à un seul agent. Les fichiers marqués « partagé » demandent de prévenir l'autre avant de les modifier.

### voix-marchand (binôme)

Mission : tout ce que le marchand voit, dit et entend.

| Fichiers | Rôle |
| --- | --- |
| `src/lib/aethex.ts` | Appels AethexAI (voix vers texte, texte vers voix) |
| `src/lib/audioClient.ts` | Micro, arrêt au silence, WAV 16 kHz |
| `src/lib/intent.ts`, `src/lib/frenchNumbers.ts` | Compréhension de la commande et des montants |
| `src/app/page.tsx`, `src/app/globals.css` (partie marchand) | Écran marchand |
| `src/app/api/turn`, `src/app/api/tts`, `src/app/api/health` | Routes voix |
| `tests/numbers.test.ts` | Tests des montants |
| `src/lib/dialog.ts` (partagé) | Machine d'états du dialogue (`handleTurn`) |

Tâches :
- [ ] Étape 1 : script `scripts/test-aethex.ts`, appels réels, correction de `aethex.ts`.
- [ ] Étape 1 : `/api/health` renvoie `"aethex": true`.
- [ ] Étape 3 : HTTPS, micro réel sur téléphone, test dans le bruit, arrêt au silence réglé.
- [ ] Étape 5 : pictogrammes sur la confirmation, textes de l'agent courts et naturels.
- [ ] Mode secours vérifié (clavier + voix du navigateur) en coupant AethexAI.

### argus-contrainte (Emmanuel)

Mission : le score, la décision, la phrase secrète et ce que voit l'analyste.

| Fichiers | Rôle |
| --- | --- |
| `src/lib/risk.ts` | Score à six critères (`scoreRisk`) |
| `src/lib/text.ts` | Détection floue de la phrase secrète |
| `src/lib/config.ts` | Seuils et configuration |
| `src/lib/store.ts` (alertes et seuils) | Alertes, état en mémoire |
| `src/app/analyste/page.tsx`, `src/app/api/state`, `src/app/api/reset` | Écran analyste |
| `tests/risk.test.ts` (à créer), parties contrainte de `tests/dialog.test.ts` | Tests |
| `src/lib/dialog.ts` (partagé) | Fonctions `evaluate`, `execute`, `handleDuress` |

Tâches :
- [ ] Étape 2 : rejouer les 4 scénarios en mode texte, tests automatiques pour chacun.
- [ ] Étape 2 : vérifier à la main que la phrase secrète n'apparaît ni à l'écran marchand, ni dans les alertes, ni dans les logs.
- [ ] Étape 2 : un test de référence par critère et par décision (accepter, vérifier, bloquer).
- [ ] Étape 5 : bannière rouge « Contrainte signalée », animation, rythme.
- [ ] Étape 5 : choisir la vraie phrase secrète, vérifier la détection avec une transcription imparfaite.
- [ ] Étape 6 (avec support-leads) : panneau « Prospects » sur l'écran analyste.

### caisse-jeko (Emmanuel)

Mission : la fausse caisse, qui doit imiter l'API réelle de Jèko.

| Fichiers | Rôle |
| --- | --- |
| `src/lib/jekoMock.ts` | Demande de paiement, paiement reçu, transfert |
| `src/app/api/paid` | Simule le paiement du client |
| `src/app/api/webhook/jeko` (à créer) | Réception du webhook signé |
| `tests/jeko.test.ts` (à créer) | Tests de la caisse |

Tâches :
- [ ] Étape 4 : montants en `amountCents` (FCFA fois 100).
- [ ] Étape 4 : webhook `TRANSACTION_COMPLETED` au format exact donné par Jèko (voir `CLAUDE.md`, section 4.4).
- [ ] Étape 4 : signature `Jeko-Signature` (HMAC-SHA256 du corps brut) vérifiée, comparaison à temps constant.
- [ ] Étape 4 : test : signature valide acceptée, signature fausse refusée, « Paiement reçu » annoncé seulement après vérification.

### support-leads (les deux)

Mission : répondre aux questions et repérer les vrais prospects.

| Fichiers | Rôle |
| --- | --- |
| `src/lib/kb.ts` | Base de réponses sourcées |
| `src/lib/leads.ts` (à créer) | Qualification et score chaud, tiède, froid |
| `src/app/prospect/page.tsx` (à créer) | Page visiteur |
| `tests/support.test.ts` (à créer) | Tests du support et des prospects |

Tâches :
- [ ] Étape 6 : réponses sourcées pour le plafond, les niveaux de vérification, les frais, la présence en Côte d'Ivoire.
- [ ] Étape 6 : vérifier les frais sur le site de Jèko avant la présentation.
- [ ] Étape 6 : question hors base : passage à un humain avec résumé.
- [ ] Étape 6 : quatre questions de qualification, règle simple et écrite pour « chaud, tiède, froid ».
- [ ] Étape 6 : un prospect chaud apparaît sur l'écran analyste.

### Agents de contrôle (ECC)

- **planner** : au début de chaque journée, lit `CLAUDE.md` et ce fichier, propose l'ordre du jour et signale ce qui bloque. Il écrit des plans, il ne modifie pas le code.
- **tdd-guide** : sur demande, écrit le test d'une tâche avant le code. À utiliser pour la contrainte, la caisse et les montants.
- **security-reviewer** : relit chaque lot de modifications. Cherche : clé dans le navigateur ou dans git, phrase secrète dans une réponse, une alerte ou un log, webhook accepté sans signature.
- **e2e-runner** : rejoue les 4 scénarios de la démo à la fin des étapes 2, 3 et 7 et rapporte ce qui échoue.

---

## 4. Les points de branchement (contrats entre agents)

Les agents travaillent en parallèle parce que ces contrats ne changent pas sans prévenir.

| De | Vers | Contrat |
| --- | --- | --- |
| voix-marchand | dialogue | Entrée : texte transcrit. Sortie : `{heard, reply, speech, awaitingConfirm, payment?}` (route `/api/turn`). |
| dialogue | argus-contrainte | `scoreRisk(opération, contexte)` renvoie `{score, decision, factors}` avec `decision` parmi accepter, vérifier, bloquer. |
| dialogue | argus-contrainte | `handleDuress` renvoie la même réponse qu'un succès, retient l'opération et crée l'alerte critique. |
| dialogue | caisse-jeko | `createPaymentRequest`, `createTransfer`, `markPaid`, avec montants en `amountCents` à la frontière de l'API Jèko. |
| caisse-jeko | voix-marchand | Après un webhook valide, l'annonce « Paiement reçu » est dite par la voix. |
| argus-contrainte | analyste | Alertes `{niveau, titre, message public}`. Le message public ne contient jamais la phrase secrète (`publicTranscript`). |
| support-leads | analyste | Fiche prospect `{activite, volume, moyens_paiement, ville, interet, resume}`. |

Si un agent doit changer l'un de ces contrats, il s'arrête, l'écrit dans son rapport et attend la décision humaine.

---

## 5. Ordre de travail sur trois jours

### Mercredi 28 (en parallèle)

| Emmanuel | Binôme |
| --- | --- |
| planner : plan du jour | planner : plan du jour |
| argus-contrainte : étape 2 (scénarios, tests, fuite de la phrase) | voix-marchand : étape 1 (appels AethexAI réels) |
| security-reviewer sur l'étape 2 | e2e-runner dès que la voix répond |

Fin de journée : première fusion dans `main` (fin de l'étape 2). Point de 10 minutes à deux.

### Jeudi 29

| Emmanuel | Binôme |
| --- | --- |
| caisse-jeko : étape 4 | voix-marchand : étape 3 (HTTPS, micro, bruit) |
| argus-contrainte : étape 5 (bannière, phrase secrète) | voix-marchand : pictogrammes et textes de l'agent |
| support-leads : étape 6, ensemble | support-leads : étape 6, ensemble |

Jeudi soir : **gel des fonctionnalités**, deuxième fusion. Après le gel, seulement des corrections.

### Vendredi 30

| Les deux |
| --- |
| e2e-runner : les 4 scénarios sur le matériel de la présentation |
| security-reviewer : dernière relecture |
| Vidéo de secours, README à jour avec le script de démo |
| Livraison du prototype, répétition du pitch avec chronomètre |

### Samedi 31

Présentation.

---

## 6. Comment travailler avec un agent

1. Ouvrir Claude Code dans le dossier du projet (il lit `CLAUDE.md` tout seul).
2. Donner une tâche précise, avec l'étape et le critère de fin. Exemple : « Utilise l'agent argus-contrainte pour l'étape 2 : rejoue les 4 scénarios en mode texte et écris les tests. Critère de fin : tests verts et la phrase secrète absente des réponses, alertes et logs. »
3. Relire son rapport. Une tâche n'est cochée que si le critère est **vérifié**, pas si l'agent dit que c'est fait.
4. Faire passer security-reviewer sur chaque lot, puis fusionner.

Une branche par personne (`emmanuel`, `binome`), `main` toujours en état de marche. Fusion à trois moments : fin de l'étape 2, fin de l'étape 5, gel du jeudi soir.

---

## 7. Fichiers de définition à créer

Les quatre agents « À créer » sont des fichiers dans `.claude/agents/`. Modèles à copier, puis à ajuster :

### `.claude/agents/voix-marchand.md`

```markdown
---
name: voix-marchand
description: Écran marchand, micro, AethexAI, compréhension des commandes et des montants. À utiliser pour les fonctionnalités F01 à F04 et F08.
tools: Read, Edit, Write, Bash, Grep, Glob
---
Tu travailles sur la partie vocale du projet Jèko Voix. Lis CLAUDE.md et TACHES-AGENTS.md avant de commencer.
Tes fichiers : src/lib/aethex.ts, audioClient.ts, intent.ts, frenchNumbers.ts, src/app/page.tsx, api/turn, api/tts, api/health, tests/numbers.test.ts.
dialog.ts est partagé : préviens avant de le modifier.
La clé AethexAI ne quitte jamais le serveur. Le format des réponses AethexAI est à vérifier à la première vraie réponse.
Termine par npm test et npm run typecheck, puis un rapport : fait, vérifié (comment), reste.
```

### `.claude/agents/argus-contrainte.md`

```markdown
---
name: argus-contrainte
description: Score de risque Argus, décisions, phrase secrète de contrainte et écran analyste. À utiliser pour F05 à F07 et F09.
tools: Read, Edit, Write, Bash, Grep, Glob
---
Tu travailles sur la sécurité du projet Jèko Voix. Lis CLAUDE.md et TACHES-AGENTS.md avant de commencer.
Tes fichiers : src/lib/risk.ts, text.ts, config.ts, store.ts (alertes), src/app/analyste/page.tsx, api/state, api/reset, tests/risk.test.ts.
dialog.ts est partagé : évaluate, execute et handleDuress sont à toi, préviens avant de toucher au reste.
Règle absolue : la phrase secrète n'apparaît ni à l'écran marchand, ni dans une alerte, ni dans un log, ni dans git. Sous contrainte, la réponse est identique à un succès, rien n'est transféré, une alerte critique part.
Termine par npm test et npm run typecheck, puis un rapport : fait, vérifié (comment), reste.
```

### `.claude/agents/caisse-jeko.md`

```markdown
---
name: caisse-jeko
description: Fausse caisse Jèko au format réel (demande de paiement, webhook signé). À utiliser pour F10.
tools: Read, Edit, Write, Bash, Grep, Glob
---
Tu travailles sur la fausse caisse du projet Jèko Voix. Lis CLAUDE.md (section 4.4) et TACHES-AGENTS.md avant de commencer.
Tes fichiers : src/lib/jekoMock.ts, api/paid, api/webhook/jeko, tests/jeko.test.ts.
Montants en amountCents (FCFA fois 100). Webhook TRANSACTION_COMPLETED au format exact donné par Jèko, signé en HMAC-SHA256 du corps brut (en-tête Jeko-Signature), vérifié en temps constant.
Aucun appel à la vraie API Jèko : elle déplace de l'argent réel.
Termine par npm test et npm run typecheck, puis un rapport : fait, vérifié (comment), reste.
```

### `.claude/agents/support-leads.md`

```markdown
---
name: support-leads
description: Agent de support (base de réponses sourcées) et qualification de prospects. À utiliser pour F11 et F12.
tools: Read, Edit, Write, Bash, Grep, Glob
---
Tu travailles sur le support et les prospects du projet Jèko Voix. Lis CLAUDE.md et TACHES-AGENTS.md avant de commencer.
Tes fichiers : src/lib/kb.ts, src/lib/leads.ts, src/app/prospect/page.tsx, tests/support.test.ts.
Chaque réponse cite sa source. Une question hors base passe à un humain avec un résumé. N'invente aucun chiffre : les frais et les niveaux de vérification sont à vérifier sur les sources de Jèko.
Le panneau Prospects de l'écran analyste est partagé avec argus-contrainte : préviens avant de le modifier.
Termine par npm test et npm run typecheck, puis un rapport : fait, vérifié (comment), reste.
```

---

## 8. Si ECC prend trop de temps

L'installation d'ECC ne doit pas manger la journée. Si elle dépasse 30 minutes, on abandonne ECC et on garde les quatre agents écrits par nous (section 7). Les rôles planner, tdd-guide, security-reviewer et e2e-runner se jouent alors comme des consignes données à l'agent principal : « relis ce lot comme un reviewer de sécurité », « rejoue les 4 scénarios ».
