# Jèko Voix protégé par Argus : guide de construction

Hackathon M.Studio x AethexAI. Startup assignée : Jèko.
Prototype à livrer le vendredi 30 octobre 2026. Présentation le samedi 31 octobre 2026.
Ce fichier est notre référence de construction. Il reprend le cahier des charges technique (F01 à F12) et le transforme en étapes à suivre dans l'ordre. Si tu es un assistant de code : lis tout avant de commencer, et suis l'ordre des étapes.

---

## 0. Règles de travail (à respecter tout le temps)

1. **Le moment fort d'abord.** C'est le code de contrainte (la phrase secrète). Il doit être très abouti avant de toucher au support.
2. **Ne rien inventer.** Aucun chiffre de performance, aucune statistique, aucune fonctionnalité annoncée qui n'existe pas. Ce qui est simulé est dit comme simulé.
3. **Pas d'argent réel dans la démo.** Jèko n'a pas de mode test. Toute la démo tourne sur notre fausse caisse.
4. **La clé AethexAI ne quitte jamais le serveur.** Jamais dans le navigateur, jamais dans git.
5. **La phrase secrète n'apparaît nulle part** : ni sur l'écran du marchand, ni dans une alerte, ni dans un log, ni dans git (elle vient de la configuration).
6. **Aucune opération d'argent sans confirmation** du marchand (oui à la voix ou bouton).
7. **Tester avant d'affirmer.** Une fonctionnalité est « faite » quand son critère de fin (section 6) est vérifié, pas quand le code est écrit.
8. **Ne pas élargir le périmètre.** Ce qui est hors périmètre (section 2) reste hors périmètre sauf décision des deux membres.
9. Texte de l'interface et documents en français, sans tirets longs.

---

## 1. Le projet en 30 secondes

Jèko est une fintech d'Abidjan qui équipe les commerçants informels (JèkoBox, liens de paiement, app Jèko Business, API d'agrégation). Ses ingénieurs nous ont donné trois problèmes :

1. **Commander sans lire** : le commerçant dit « encaisse 5 000 » et l'app agit.
2. **Support et ventes** : équipe réduite, questions de visiteurs et d'utilisateurs à trier.
3. **Fraude** : plus d'un million de transactions par mois, rien pour repérer les comportements bizarres. Ils aiment le code de contrainte d'Argus et proposent de le relier à la voix.

Notre réponse : **un agent vocal unique, protégé par Argus.** La voix fait entrer le marchand dans l'app, et c'est la même voix qui le protège.

L'histoire de la démo : Awa vend des légumes au marché et ne sait pas lire. Le matin elle encaisse en parlant. Le soir, on la force à transférer de l'argent. Elle dit sa phrase secrète au milieu d'une phrase normale. L'écran affiche « C'est envoyé », l'argent ne part pas, et Karim, l'analyste de Jèko, voit une bannière rouge.

### Les quatre briques

| Brique | Rôle | Ce qu'elle ne fait pas |
| --- | --- | --- |
| AethexAI | Les oreilles et la bouche : voix vers texte, texte vers voix ivoirienne | Ne décide rien |
| Notre agent | Le cerveau : comprend, relit, demande confirmation, répond au support | N'exécute rien sans Argus ni le marchand |
| Argus | Le garde du corps : score de risque, décision, phrase secrète | Ne parle pas, rend une décision à l'agent |
| Jèko (simulé) | La caisse : paiement, transfert, webhook | Aucun argent réel |

### Flux d'une commande vocale

1. Le marchand appuie sur le micro et parle.
2. AethexAI transforme la voix en texte.
3. L'agent comprend la commande et demande ce qui manque.
4. Argus calcule le score et décide : accepter, vérifier ou bloquer.
5. L'agent relit le montant, donne la raison du doute si besoin, demande confirmation.
6. Oui : la caisse exécute et AethexAI annonce le résultat.
7. Oui + phrase secrète : même écran de succès, opération **retenue**, alerte critique chez l'analyste.
8. Score 65 ou plus : refus poli et alerte « rappel à faire ».

### Cycle de vie d'une opération

`Brouillon` (commande incomplète) → `À confirmer` (score sous 65) → `Exécutée` (oui) | `Annulée` (non) | `Retenue` (oui + phrase secrète).
`Brouillon` → `Bloquée` (score 65 ou plus).
Une opération retenue ne transfère rien. Retenue et bloquée créent une alerte.

---

## 2. Périmètre

### Inclus (12 fonctionnalités)

| Réf. | Fonctionnalité | Priorité |
| --- | --- | --- |
| F01 | Capture vocale (bouton micro, arrêt au silence) | P0 |
| F02 | Reconnaissance vocale AethexAI | P0 |
| F03 | Compréhension de la commande (encaisser, envoyer, bilan, montants en mots ou chiffres) | P0 |
| F04 | Relecture et confirmation | P0 |
| F05 | Score de risque Argus | P0 |
| F06 | Décision parlée (accepter, vérifier, bloquer) | P0 |
| F07 | Code de contrainte (moment fort) | P0 |
| F08 | Réponse vocale AethexAI | P0 |
| F09 | Écran analyste | P0 |
| F10 | Fausse caisse Jèko au format réel | P0 |
| F11 | Agent de support | P1 |
| F12 | Qualification de prospects et passage à un humain | P1 |

Options, dans cet ordre, seulement si on a du temps : choix de la phrase secrète à la voix, traitement des alertes (nouvelle, prise en charge, résolue), journal d'audit exportable.

### Hors périmètre (ne pas faire)

- Argent réel et vrais transferts.
- Modifier l'app Jèko Business (nous livrons un écran à part qui pourrait s'y intégrer).
- Langues locales (dioula, baoulé) : AethexAI ne documente que le français et l'anglais.
- Monitoring d'un million de transactions par mois.
- Conversation vocale temps réel (WebRTC), base de données persistante.

### Répartition proposée

| Qui | Fonctionnalités |
| --- | --- |
| Emmanuel | F05, F06, F07 (Argus et contrainte), F09 (écran analyste), F10 (fausse caisse) |
| Binôme | F01, F02, F03, F04, F08 (écran marchand et voix AethexAI) |
| Ensemble | F11, F12 (support), pitch, démo, vidéo de secours |

---

## 3. Pile technique

| Couche | Choix |
| --- | --- |
| Interface et serveur | Next.js 15 (App Router), React 19, TypeScript, un seul projet |
| Audio navigateur | MediaRecorder, encodage WAV 16 kHz côté client |
| Voix | API AethexAI (`/transcribe`, `/tts`) appelée uniquement depuis le serveur |
| Risque | Module TypeScript Argus simplifié (6 critères) |
| Caisse | Module qui imite l'API Jèko et ses webhooks signés |
| Données | Mémoire du serveur, pas de base de données |
| Tests | `node:test` via `tsx`, Playwright pour les captures |
| Hébergement | HTTPS obligatoire (le micro du téléphone ne marche pas sans) |
| Secours | Saisie clavier et voix du navigateur (`speechSynthesis`) |

### Base de départ : le prototype v1

Un prototype brouillon existe (`jeko-voix.zip`). Il contient déjà le dialogue, le score, la phrase secrète, la fausse caisse, l'écran marchand, l'écran analyste et 15 tests. Il sert de point de départ, pas de vérité : tout est à vérifier et à ajuster. Si le dossier ne contient pas encore ce code, décompresser le zip dans le dossier du projet, puis `npm install`.

Structure actuelle :

```
src/lib/frenchNumbers.ts   montants parlés <-> chiffres
src/lib/intent.ts          compréhension des phrases
src/lib/text.ts            normalisation, distance de Levenshtein, détection floue
src/lib/risk.ts            score de risque Argus simplifié
src/lib/dialog.ts          dialogue, confirmation, contrainte
src/lib/store.ts           état en mémoire (opérations, alertes, sessions)
src/lib/config.ts          configuration et seuils
src/lib/kb.ts              base de réponses du support
src/lib/jekoMock.ts        simulateur de l'API Jèko
src/lib/aethex.ts          reconnaissance et synthèse vocales AethexAI (non testé en vrai)
src/lib/audioClient.ts     enregistrement micro et encodage WAV
src/app/page.tsx           écran marchand
src/app/analyste/page.tsx  écran analyste
src/app/api/turn           un tour de dialogue (audio ou texte)
src/app/api/tts            synthèse vocale
src/app/api/paid           simule le paiement du client
src/app/api/state          état pour l'écran analyste
src/app/api/reset          remet la démo à zéro
src/app/api/health         indique si AethexAI est configuré
tests/                     numbers.test.ts, dialog.test.ts
```

### Variables d'environnement (`.env.local`, jamais dans git)

```
AETHEX_API_KEY=ae_live_...            # clé AethexAI, côté serveur uniquement
AETHEX_BASE_URL=https://api.aethexai.com/api/v1
AETHEX_VOICE_ID=c32631f7-1018-54aa-84f8-725411de8636   # voix ivoirienne Adjoua
DURESS_PHRASE=j'ai laissé la marmite sur le feu        # à changer avant la présentation
DEMO_MODE=1
```

Commandes : `npm install`, `npm run dev` (http://localhost:3000), `npm test`, `npm run typecheck`, `npm run build`.
Écran marchand : `/` (mode test clavier avec `?test=1`). Écran analyste : `/analyste`.

---

## 4. Spécifications techniques de référence

### 4.1 AethexAI (voix)

Documentation : https://developers.aethexai.com
Base : `https://api.aethexai.com/api/v1`. En-tête : `X-API-Key: ae_live_...`. Il n'y a pas d'offre gratuite : il faut des crédits.

- **Voix vers texte** : `POST /transcribe`, multipart, champ `file` (WAV, FLAC ou Ogg/Opus, 8 Mio maximum), `language=french`.
- **Texte vers voix** : `POST /tts`, `text` (650 caractères maximum), `language` (`french` ou `english`), `voice_id`. Retour : WAV 24 kHz.
- 53 voix françaises de Côte d'Ivoire. Par défaut : Adjoua (`c32631f7-1018-54aa-84f8-725411de8636`).
- Seuls le français et l'anglais sont documentés. Dioula et baoulé ne le sont pas.
- **Non testé en vrai** : nous n'avons jamais pu appeler l'API depuis l'environnement de développement initial. Le format exact des réponses (champ du texte transcrit, en-têtes du WAV) est à vérifier à la première vraie réponse, puis corriger `src/lib/aethex.ts`.

### 4.2 Argus simplifié (score de risque)

Score de 0 à 100 en additionnant des points. Ce n'est **pas** le moteur Argus complet (11 critères, confidentiels) : c'est une version illustrative à six critères.

| Critère | Points |
| --- | --- |
| Sortie d'argent (transfert, pas encaissement) | +10 |
| Montant par rapport au panier moyen du marchand | 2 fois ou plus : +10, 4 fois ou plus : +20, 10 fois ou plus : +30 |
| Montant au-dessus du plafond (200 000 FCFA, à confirmer) | +25 |
| Bénéficiaire inconnu | +20 |
| Heure de nuit (22 h à 5 h) | +15 |
| Rafale : 3 opérations ou plus en 10 minutes | +15 (5 ou plus : +25) |

Décisions : moins de 35 = **accepter** ; de 35 à 64 = **vérifier** (l'agent dit la raison à voix haute avant de demander le oui) ; 65 ou plus = **bloquer** (refus poli, alerte « rappel à faire »).
Chaque score garde la liste de ses raisons (points et explication) pour l'écran analyste.
Les valeurs par défaut du prototype : panier moyen 4 500 FCFA (10 encaissements d'exemple), contacts connus Fatou, Mamadou, Adjoua.

### 4.3 Code de contrainte (le moment fort)

- Phrase secrète lue depuis `DURESS_PHRASE`. Par défaut : « j'ai laissé la marmite sur le feu ».
- Elle est dite **pendant la confirmation**, mélangée à une phrase normale (« oui, c'est bon, j'ai laissé la marmite sur le feu »).
- Détection **floue** (tolère une erreur de reconnaissance par mot de 5 lettres ou plus, seuil 0,8) car la transcription n'est jamais parfaite.
- Quand elle est détectée :
  1. La réponse vocale et l'écran du marchand sont **identiques à un succès normal** (« C'est envoyé »).
  2. **Rien n'est transféré** : l'opération passe à l'état `Retenue`.
  3. Une alerte **critique** part vers l'écran analyste avec le contexte (montant, bénéficiaire, score, raisons).
  4. La phrase n'est stockée nulle part : on ne garde qu'une version publique de ce que le marchand a dit (`publicTranscript`).
- Politique actuelle : retenir l'opération. Décision à confirmer avec Jèko (retenir, différer ou faire comme si l'opération était partie).
- Limite à dire franchement : un agresseur qui entend la phrase peut la comprendre. Elle protège contre la contrainte, pas contre toutes les fraudes.

### 4.4 Fausse caisse Jèko (F10)

Elle doit imiter l'API réelle (documentation : https://developer.jeko.africa) pour que l'intégration future soit directe.

- En-têtes d'authentification : `X-API-KEY` et `X-API-KEY-ID`.
- Demande de paiement : `POST /partner_api/payment_requests`, avec `storeId`, `amountCents`, `currency` (`XOF`), `reference`, `paymentDetails`.
- **Montants en `amountCents`** : 5 FCFA s'écrit `500` (donc FCFA multiplié par 100). Minimum Mobile Money : 5 FCFA.
- `GET /partner_api/stores` renvoie les magasins (le `storeId`).
- Les transferts utilisent les mêmes clés.
- Pas de sandbox chez Jèko : un test avec la vraie API déplace de l'argent réel. Le vrai branchement est un bonus facultatif, jamais pour la scène de la contrainte.

Webhook que Jèko nous a donné (événement `TRANSACTION_COMPLETED`), à reproduire à l'identique :

```json
{
  "id": "txn_1234567890",
  "amount": { "amount": 1000, "currency": "XOF" },
  "fees": { "amount": 15, "currency": "XOF" },
  "status": "success",
  "counterpartLabel": "Jean Dupont",
  "counterpartIdentifier": "+2250701234567",
  "paymentMethod": "wave",
  "transactionType": "payment",
  "businessName": "Votre Entreprise",
  "storeId": "01a0b1c2-d3e4-7f89-a0b1-c2d3e4f5a6b7",
  "storeName": "Votre Magasin",
  "executedAt": "2024-01-15 14:30:25",
  "transactionDetails": {
    "id": "d22c81f3-ee04-4ec5-8bd2-cd8af5dabcfc",
    "reference": "PAY-001",
    "paymentLinkId": null
  }
}
```

En-têtes de chaque livraison :

- `Jeko-Event: TRANSACTION_COMPLETED`
- `Jeko-Signature: <HMAC-SHA256 du corps brut, en hexadécimal>`
- `Jeko-Webhook-Version: 1`

Notre simulation doit signer le corps brut avec une clé de démo, et notre récepteur doit vérifier la signature (comparaison à temps constant) avant d'annoncer « Paiement reçu ».

### 4.5 Modèle de données (en mémoire)

| Entité | Champs clés |
| --- | --- |
| operation | id, type (encaissement ou transfert), montant_xof, moyen (wave, orange, mtn, moov), beneficiaire, statut, score, decision, horodatage |
| facteur_risque | operation_id, critere, points, raison |
| alerte | id, operation_id, niveau (info, attention, critique), titre, message, horodatage |
| session | id, étape du dialogue, commande en cours |
| contact_connu | nom, telephone |
| reponse_support | sujet, mots_cles, reponse, source |
| prospect | id, activite, volume, moyens_paiement, ville, interet (chaud, tiède, froid), resume |

### 4.6 Compréhension de la commande (F03)

- Intentions : encaisser, envoyer, bilan du jour, question de support, inconnu.
- Montants dits en chiffres ou en mots (« cinq mille », « cent cinquante mille »). Affichage en chiffres, voix en mots.
- Moyens de paiement reconnus : Wave, Orange, MTN, Moov.
- Si le montant ou le bénéficiaire manque, l'agent le demande.
- Les noms gardent leurs accents (Koné, pas Kone).
- Un « non » annule. Une nouvelle commande pendant la confirmation remplace la précédente.

---

## 5. Les écrans

### Écran marchand (`/`)

- Fond jaune, un seul très grand bouton micro, une couleur par état (écoute, réflexion, réponse).
- La réponse de l'agent s'affiche en très gros et est lue à voix haute.
- Deux gros boutons Oui / Non pendant la confirmation.
- Pensé pour quelqu'un qui ne lit pas : peu de texte, pictogrammes à ajouter sur la confirmation.
- Mode test clavier avec `?test=1` (sans micro) pour travailler et pour le secours.

### Écran analyste (`/analyste`)

- Fond sombre, pensé pour le grand écran de la présentation.
- Compteurs, liste des alertes (score, raisons), tableau des opérations avec leur état.
- **Bannière rouge « Contrainte signalée »** à l'arrivée d'une alerte critique, avec une animation soignée. C'est la scène qui doit marquer.
- Mise à jour automatique toutes les 1,2 seconde.
- Bouton « Réinitialiser la démo ».
- Panneau « Prospects » à ajouter avec F12.

---

## 6. Ordre de construction (avec critères de fin)

Chaque étape finit quand son critère est vérifié. Ne passe à l'étape suivante que si le critère de la précédente est rempli, sauf pour les étapes qui se font en parallèle (voir la répartition).

### Étape 0 : dépôt et socle (mercredi, 20 minutes)

- Créer le dépôt GitHub, inviter le binôme, décider des branches (`main` + une branche par personne).
- Mettre le prototype v1 dans le dossier, `npm install`, `npm test`, `npm run dev`.
- Créer `.env.local` à partir de `.env.local.example`. Vérifier que `.env.local` est dans `.gitignore`.
- **Fini quand** : les 15 tests passent, `/` (avec `?test=1`) et `/analyste` s'ouvrent, et rien de secret n'est dans git.

### Étape 1 : voix réelle AethexAI (mercredi, priorité maximale)

C'est le plus gros risque, car l'API n'a jamais été appelée en vrai.
- Obtenir la clé et vérifier les crédits sur developers.aethexai.com.
- Écrire un petit script `scripts/test-aethex.ts` qui envoie un enregistrement de ta voix à `/transcribe`, puis une phrase à `/tts` et sauvegarde le WAV reçu.
- Corriger `src/lib/aethex.ts` d'après les vraies réponses.
- **Fini quand** : le texte transcrit est correct pour « encaisse cinq mille francs par Wave », le WAV d'Adjoua s'écoute, et `/api/health` renvoie `"aethex": true`.
- Si ça ne marche pas : on le sait tout de suite, on garde le mode secours et on prévient l'équipe d'AethexAI.

### Étape 2 : le moment fort, de bout en bout en mode texte (mercredi)

Sans micro, avec `?test=1`, vérifier le scénario complet :
1. « Encaisse cinq mille francs par Wave » → relecture → oui → paiement simulé → annonce.
2. « Envoie cent cinquante mille francs à Koné » → vérification parlée (raison du doute) → « Oui, j'ai laissé la marmite sur le feu » → écran « C'est envoyé ».
3. L'écran analyste montre la bannière rouge, le score et les raisons. Aucun transfert n'a eu lieu. La phrase n'apparaît nulle part.
4. « Envoie deux cent cinquante mille francs à Koné » → refus poli, alerte « rappel à faire ».
- **Fini quand** : les quatre scénarios passent, couverts par des tests automatiques, et une vérification manuelle confirme que la phrase secrète n'est ni à l'écran marchand, ni dans les alertes, ni dans les logs.

### Étape 3 : micro réel sur téléphone (jeudi matin)

- Déployer en HTTPS (tunnel ou petit serveur) : sans HTTPS le micro ne marche pas sur téléphone.
- Brancher bouton micro → enregistrement → `/api/turn` → réponse lue par AethexAI.
- Tester dans le bruit (musique, voix autour) et avec des silences. Régler l'arrêt automatique au silence (limite d'enregistrement 12 secondes).
- **Fini quand** : le scénario de l'étape 2 passe à la voix, sur un vrai téléphone, avec du bruit autour.

### Étape 4 : fausse caisse alignée sur Jèko (jeudi)

- Montants en `amountCents` (FCFA fois 100).
- Webhook `TRANSACTION_COMPLETED` au format exact de la section 4.4, avec la signature `Jeko-Signature` vérifiée.
- **Fini quand** : un paiement simulé déclenche le webhook signé, la signature est vérifiée, et l'annonce « Paiement reçu » part ensuite. Un test prouve qu'une signature fausse est refusée.

### Étape 5 : polish du moment fort (jeudi)

- Animation de la bannière rouge, rythme du récit, textes de l'agent naturels et courts.
- Pictogrammes sur la confirmation de l'écran marchand.
- Choisir la vraie phrase secrète de la démo (`DURESS_PHRASE`), la répéter à la voix et vérifier qu'elle est détectée même avec une transcription imparfaite.
- **Fini quand** : on déroule le moment fort devant quelqu'un d'extérieur qui comprend ce qu'il voit sans explication.

### Étape 6 : support et prospects (jeudi après-midi, P1)

F11, agent de support :
- Base de réponses sourcées (`src/lib/kb.ts`) : plafond de 200 000 FCFA, niveaux de vérification, frais, présence en Côte d'Ivoire.
- Frais publics de Jèko : 1,5 % (checkout et liens), 1 % (JèkoBox), 1,5 % (JèkoBox Wave). Vérifier avant la présentation sur le site de Jèko.
- Question hors base : l'agent passe la main à un humain avec un résumé.

F12, prospects :
- Page `/prospect` (texte ou voix) : l'agent pose quatre questions naturelles (activité, volume, moyens de paiement actuels, ville).
- Règle simple et documentée pour « chaud, tiède, froid » (par exemple : chaud si au moins trois réponses données et une intention claire de s'inscrire).
- Un prospect chaud, ou une question hors base, crée une fiche avec résumé, visible dans un panneau « Prospects » de l'écran analyste.
- **Fini quand** : une question de support reçoit une réponse sourcée, une question hors base crée un passage à l'humain, et un prospect chaud apparaît sur l'écran analyste.

### Étape 7 : gel, livraison, secours (jeudi soir et vendredi)

- **Gel des fonctionnalités le jeudi soir.** Après, seulement des corrections.
- Enregistrer une **vidéo de la démo complète**, au cas où le réseau ou le micro lâche.
- Vérifier le mode secours (clavier + voix du navigateur) en coupant l'accès à AethexAI.
- Livrer le prototype (vendredi 30 octobre) : lien, dépôt, README à jour avec le script de démo.
- Répéter le pitch plusieurs fois, avec chronomètre.
- **Fini quand** : la démo tourne sur le matériel de la présentation, la vidéo existe, et le script de démo est dans le README.

### Calendrier

| Jour | Étapes |
| --- | --- |
| Mercredi 28 | 0, 1, 2 |
| Jeudi 29 | 3, 4, 5, 6, gel le soir |
| Vendredi 30 | 7, livraison, répétition |
| Samedi 31 | Présentation |

---

## 7. Tests à avoir

Au minimum (certains existent déjà dans le prototype) :

- Montants : chiffres, mots, numéros de téléphone ignorés, aller-retour sur des milliers de valeurs.
- Dialogue : encaissement simple, montant manquant, bénéficiaire manquant, annulation, changement de commande.
- Score : un cas de référence par critère et par décision (accepter, vérifier, bloquer).
- Contrainte : réponse identique à un succès, opération retenue, alerte critique, **phrase absente** des réponses et des alertes, détection avec une transcription imparfaite.
- Fausse caisse : montant en `amountCents`, webhook au bon format, signature valide acceptée et signature fausse refusée.
- Support : une réponse sourcée par sujet, une question hors base qui passe à l'humain.
- Horloge figée dans les tests (`mock.timers`) : sinon la règle de rafale et la règle de nuit donnent des résultats instables.

Vérification visuelle : captures Playwright des deux écrans avant chaque livraison.

---

## 8. Démo (3 minutes)

1. **Écran marchand.** « Encaisse cinq mille francs par Wave. » L'agent relit, on dit oui, le client « paie », la voix annonce le paiement.
2. « Envoie cent cinquante mille francs à Koné. » L'agent pose une question de vérification parlée (nouveau numéro, montant inhabituel). Réponse : « Oui, j'ai laissé la marmite sur le feu. » L'écran affiche « C'est envoyé », sans aucune trace de la phrase.
3. **Grand écran.** La bannière « Contrainte signalée » apparaît avec le score et ses raisons.
4. « Envoie deux cent cinquante mille francs à Koné. » Refus poli et alerte pour un conseiller.
5. « J'ai atteint la limite de 200 000, comment augmenter mon plafond ? » Réponse du support.

Matériel : l'ordinateur relié au grand écran pour l'analyste, un téléphone pour le marchand. Changer la phrase secrète avant la présentation.

### Ce qu'on dit franchement au jury

- Réel : compréhension des montants en français, dialogue avec relecture et confirmation, score de risque, décisions, détection de la phrase secrète, écran analyste en direct.
- Simulé : l'API Jèko (aucun argent réel), le paiement du client, les données du marchand, et le moteur Argus complet (nous montrons une version simplifiée à six critères).
- Limites : la phrase secrète protège contre la contrainte, pas contre toute fraude. Langues locales non couvertes (AethexAI ne documente que le français et l'anglais). Choix entre retenir ou différer sous contrainte à valider avec Jèko.
- Questions probables : « Et si l'agresseur connaît la phrase ? », « Et le dioula et le baoulé ? », « Combien ça coûte ? », « Comment on l'intègre à Jèko ? ». Préparer des réponses honnêtes à l'avance.

---

## 9. Travail à deux

- Une branche par personne, `main` toujours en état de marche.
- Petits commits, messages clairs en français ou en anglais, mais cohérents.
- Fusionner dans `main` à des moments fixes : fin de l'étape 2, fin de l'étape 5, gel du jeudi soir.
- Ne jamais commiter `.env.local`, une clé API, ni la phrase secrète réelle.
- Avant de fusionner : `npm test` et `npm run typecheck` passent.
- Points rapides à deux, matin et soir, pour dire ce qui est fait (critère vérifié) et ce qui bloque.

---

## 10. Risques et points ouverts

| Risque ou point ouvert | Réponse prévue |
| --- | --- |
| Clé et crédits AethexAI jamais testés | Étape 1 dès mercredi, mode secours sinon |
| Bruit du marché | Tester avec du bruit à l'étape 3, régler l'arrêt au silence |
| Micro bloqué sans HTTPS | Déployer en HTTPS jeudi, pas vendredi |
| Plafond de 200 000 FCFA ambigu (par transaction ou en cumul) | Question à Jèko |
| Comportement attendu du code de contrainte | Question à Jèko : retenir, différer ou faire comme si l'opération était partie |
| Critères du jury inconnus | Tout miser sur le moment fort, très abouti |
| Langues locales non documentées | Répondre franchement, français ivoirien d'abord |
| Compte marchand nécessaire pour la vraie API Jèko | Facultatif : la démo n'en dépend pas |

Questions encore à poser à Jèko dans le groupe WhatsApp : le plafond (par transaction ou cumul) et le comportement attendu du code de contrainte.

Cases à cocher avant de passer à la suite :
- [ ] Dépôt GitHub créé, binôme invité.
- [ ] Clé AethexAI avec crédits, appels testés.
- [ ] Questions plafond et contrainte posées à Jèko.
- [ ] Fausse caisse alignée sur le format de webhook de Jèko.
- [ ] Phrase secrète de la démo choisie.
- [ ] Prototype v1 repris ou réécrit : décision prise.
