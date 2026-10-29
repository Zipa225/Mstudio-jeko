# Jèko Voix, protégé par Argus

Prototype du hackathon **M.Studio x AethexAI** (startup assignée : **Jèko**). Une commerçante parle à son téléphone ; la voix
est gérée par **AethexAI**, chaque opération est examinée par **Argus** avant d'être exécutée, et un mot secret dit pendant la
confirmation signale une contrainte à un conseiller sans que l'agresseur voie quoi que ce soit.

> Prototype de démonstration : les données du marchand sont simulées, l'état est gardé en mémoire (pas de base de données) et
> aucune route n'a d'authentification. Voir [Limites assumées](#limites-assumées).

## Sommaire

1. [Le problème et la solution](#le-problème-et-la-solution)
2. [Ce qui est réel, ce qui est simulé](#ce-qui-est-réel-ce-qui-est-simulé)
3. [Les écrans](#les-écrans)
4. [Architecture](#architecture)
5. [Démarrage rapide (sans aucune clé)](#démarrage-rapide-sans-aucune-clé)
6. [Configuration](#configuration)
7. [Brancher les vrais services](#brancher-les-vrais-services)
8. [Script de démonstration](#script-de-démonstration)
9. [Sécurité](#sécurité)
10. [Tests et qualité](#tests-et-qualité)
11. [Structure du dépôt](#structure-du-dépôt)
12. [Limites assumées](#limites-assumées)

## Le problème et la solution

Une commerçante informelle d'Abidjan (Awa) utilise Jèko Business pour encaisser et envoyer de l'argent. Deux difficultés :

- Elle lit peu : l'interface doit être **vocale**, en français, avec une relecture du montant avant toute opération.
- Elle peut être **forcée** d'envoyer de l'argent. Elle ne peut pas appeler à l'aide à voix haute.

La solution :

1. Awa dit sa demande (« Encaisse cinq mille francs par Wave »). L'assistant **relit le montant** et demande un « oui » explicite.
   Aucune opération d'argent ne part sans relecture et sans « oui ».
2. Chaque opération, encaissement comme transfert, est **examinée par Argus** (score de risque et décision : accepter, vérifier,
   refuser). Un transfert inhabituel déclenche une question de vérification parlée, avec la raison du doute.
3. Un **mot secret**, dit dans n'importe quelle phrase pendant la confirmation, déclenche le mode contrainte : l'écran affiche
   exactement le même succès qu'un envoi normal, **rien n'est transféré**, l'opération est retenue et une **alerte critique** part
   vers l'écran du conseiller (bannière rouge « Contrainte signalée », avec le montant, le bénéficiaire, le score et les raisons).
4. Un assistant de support répond aux questions avec **sa source**, et passe la main à un conseiller quand il ne sait pas.
   Une page visiteur qualifie les futurs marchands (chaud, tiède, froid).

Dans l'application mobile de Jèko, ce serait un bouton micro. L'application ne pouvant pas être modifiée pour le hackathon, la
page `/` en simule l'écran.

## Ce qui est réel, ce qui est simulé

| Brique | Statut | Précisions |
| --- | --- | --- |
| Voix (voix vers texte, texte vers voix) | **Réel** | API AethexAI, appelée uniquement depuis le serveur. Sans clé : voix du navigateur et clavier. |
| Examen du risque | **Réel (en local)** | Argus tourne dans Docker sur la machine (API NestJS, moteur ML, règles). Sans Argus : calcul local simplifié à six critères. |
| Encaissement Jèko | **Réel possible** | `JEKO_MODE=live` crée de vraies demandes de paiement (aucun bac à sable chez Jèko). Par défaut : fausse caisse. |
| Transferts Jèko | **Simulés** | Jamais envoyés à Jèko : aucun argent ne sort. Le format de contact de l'API de transfert n'est pas documenté. |
| Confirmation de paiement | **Réel (vérifié)** | « Paiement reçu » n'est dit qu'après un webhook dont la signature HMAC-SHA256, le montant et la référence sont vérifiés. Testé contre un faux Jèko ; pas encore contre un vrai webhook. |
| Marchand, historique, contacts | **Simulés** | Awa, ses dix encaissements d'exemple et trois contacts (Fatou, Mamadou, Adjoua). |
| Mot secret | **Réel** | Détection floue (tolère une lettre d'écart de transcription). Aucune valeur par défaut. |

## Les écrans

| Adresse | Pour qui | Rôle |
| --- | --- | --- |
| `/` | La commerçante | Un bouton micro, la réponse en grand, boutons Oui et Non. `?test=1` : saisie au clavier. `?debug=1` : réécoute le son envoyé. `?demo=1` : boutons du présentateur. |
| `/analyste` | Le conseiller, grand écran | Compteurs, alertes, opérations, panneau Prospects, bannière rouge de contrainte. Mise à jour toutes les 1,2 s. |
| `/prospect` | Un futur marchand | Entretien en quatre questions (activité, volume, moyens de paiement, ville), texte ou voix. |
| `/micro` | L'installateur | Étape 1 : liste les micros, barre de niveau en direct et verdict (« ce micro ne capte rien », « le son sature »), choix du bon micro. Étape 2 : compare quatre réglages (et la reconnaissance du navigateur), retient le meilleur pour l'appareil. |
| `/api/health` | Technique | Dit ce qui est branché (jamais les valeurs). |

## Architecture

Le dialogue ne connaît pas les services externes : il parle à des **ports** (interfaces), chacun ayant une implémentation réelle et
une simulée, choisies par la configuration au démarrage.

```
 Téléphone (/)  ---- voix (WAV) ---->  /api/turn  ---->  Dialogue  ----> Port Voix    ---> AethexAI (voix <-> texte)
 Écran analyste ---- sondage 1,2 s -->  /api/state          |          Port Risque   ---> Argus (API locale) | calcul local
 Visiteur (/prospect) -> /api/prospect                      |          Port Caisse   ---> Jèko (API réelle) | fausse caisse
                                                            |
 Jèko --- webhook signé --> /api/webhook/jeko ---> vérification (signature, montant, référence) ---> « Paiement reçu »
```

- **Next.js 15 + React 19 + TypeScript strict.** Un seul projet : les routes `src/app/api/*` sont le serveur, les pages sont l'interface.
- **État en mémoire** (`src/lib/store.ts`), un seul exemplaire par processus ; remise à zéro par le bouton de l'écran analyste.
- **Dialogue** (`src/lib/dialog.ts`) : machine à états (montant, bénéficiaire, relecture, confirmation). Il est synchrone avec le
  calcul local, asynchrone avec Argus et la vraie caisse ; les tours d'une même session passent toujours dans l'ordre.
- **Compréhension tolérante** (`src/lib/intent.ts`) : la reconnaissance vocale écrit mal certains mots (« envoie » devient « on voit »,
  « Wave » devient « 8 » ou « vague »). Quand la phrase parle d'argent (un montant et « francs »), ces erreurs connues sont réparées avant
  l'analyse. Quand un montant est compris sans verbe, l'assistant **ne devine pas** : il demande « Tu veux encaisser ou envoyer 5 000 francs ? »
  et garde le montant. Hors phrase d'argent rien n'est réparé (« on voit que c'est bien » reste inconnu).
- **Contrainte** (`src/lib/duress.ts`) : la réponse sous contrainte et la réponse normale viennent de **la même fonction**
  (`successTurn`) : elles sont identiques par construction.
- **Repli** : si Argus est injoignable, le calcul local prend le relais et une alerte « mode dégradé » est envoyée à l'analyste.
  Si AethexAI ne peut pas faire parler l'assistant, la page utilise la voix du navigateur. Pour écouter, la page `/micro` peut retenir
  la reconnaissance du navigateur, et le clavier reste toujours disponible.

### Décisions d'Argus

| Argus | Dans l'application |
| --- | --- |
| ALLOW | Relecture, puis exécution après « oui » |
| VERIFY | Question de vérification avec la raison du doute, puis exécution après « oui » |
| QUARANTINE, BLOCK | Refus poli, alerte « rappel à faire » chez l'analyste |

Le délai laissé au moteur ML d'Argus est porté à **1500 ms** dans `docker/argus/docker-compose.yml` (150 ms par défaut chez Argus) : après un
moment d'inactivité, Argus assemble ses données « sur cache froid » en environ une seconde, et au-delà de 150 ms il passait en repli
« fail-closed », donc refusait un encaissement normal (observé sur le premier encaissement d'une démonstration).

Argus est mis en place avec **deux règles de démonstration** (`npm run argus:regles`) : 100 000 FCFA ou plus vers un nouveau
bénéficiaire déclenche la vérification, plus de 200 000 FCFA est refusé. Le modèle seul n'est pas sensible au montant : un transfert
de 100 millions de FCFA y vaut un score de 4 sur 100.

Calcul local de secours (six critères, score de 0 à 100, vérifier à partir de 35, refuser à partir de 65) : sortie d'argent +10,
montant plus de 2, 4 ou 10 fois le panier moyen (+10, +20, +30), plafond de 200 000 FCFA dépassé +25, bénéficiaire inconnu +20,
nuit (22 h à 5 h) +15, rafale d'opérations +15 ou +25.

## Démarrage rapide (sans aucune clé)

Prérequis : **Node.js 20.12 ou plus** (testé avec Node 24).

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Ouvrez http://localhost:3000. Sans clé, tout fonctionne en mode secours : fausse caisse, calcul de risque local, saisie au clavier
(`/?test=1`) et voix du navigateur. Si le port 3000 est pris : `npx next dev -p 3100`.

Pour vérifier le projet :

```bash
npm run typecheck
npm test
npm run build
```

## Configuration

Toute la configuration passe par `.env.local` (jamais commité). Le modèle `.env.local.example` ne contient aucune valeur secrète.

| Variable | Rôle | Si vide |
| --- | --- | --- |
| `AETHEX_API_KEY` | Clé AethexAI | Voix du navigateur et clavier |
| `AETHEX_BASE_URL`, `AETHEX_VOICE_ID` | Adresse de l'API et voix (`npm run aethex:voices` les liste) | Adresse officielle, voix par défaut |
| `DURESS_PHRASE` | Mot ou phrase secrète de contrainte | **Détection désactivée** (jamais de valeur par défaut) |
| `ARGUS_URL`, `ARGUS_LICENSE_KEY` | API Argus et licence (`npm run argus:licence` les écrit) | Calcul local |
| `ARGUS_MODE=local` | Impose le calcul local même si Argus est configuré | |
| `ARGUS_TIMEOUT_MS` | Délai maximal d'Argus (200 à 10 000) | 2 000 |
| `JEKO_MODE=live` | Active la vraie caisse (exige les trois valeurs suivantes) | Fausse caisse |
| `JEKO_API_KEY`, `JEKO_API_KEY_ID`, `JEKO_STORE_ID` | Clés et boutique Jèko Business | |
| `JEKO_WEBHOOK_SECRET` | Clé de signature des webhooks Jèko | Clé aléatoire (les vrais webhooks seront refusés) |
| `PUBLIC_BASE_URL` | Adresse publique (retour du client, webhook) | `http://localhost:3000` |
| `DEMO_MODE=1` | Aides de démonstration : simuler le client, remise à zéro, test du micro | |

**Mot secret.** Un secret de plusieurs mots doit contenir au moins deux mots de quatre lettres ou plus. Un secret d'**un seul mot**
est accepté s'il a au moins cinq lettres : il suffit alors de le dire dans n'importe quelle phrase (l'écran analyste signale ce
mode, car un mot courant peut se déclencher par erreur). Plus court : la détection reste désactivée et le dit.

## Brancher les vrais services

### AethexAI

```bash
# 1. Mettre AETHEX_API_KEY dans .env.local
npm run aethex:voices   # liste les voix françaises, à recopier dans AETHEX_VOICE_ID
npm run aethex:test     # synthèse puis transcription d'une phrase (consomme quelques crédits)
```

La reconnaissance vocale d'AethexAI supporte mal le bruit (mesuré : un peu de bruit suffit à lui faire inventer des phrases). Utilisez
un micro-casque et la page `/micro`, qui retient le meilleur réglage pour l'appareil.

### Argus (Docker)

Argus tourne dans Docker avec `docker/argus/docker-compose.yml` : base de données, cache, migrations, moteur ML et API, publiés sur
`127.0.0.1:4040` seulement. Les sources viennent de la branche `develop` d'Argus, exportées par défaut dans
`../true-argus/argus-develop` (à côté du dossier de ce projet ; modifiable avec la variable `ARGUS_DIR`) :

```bash
# Depuis le dossier du clone d'Argus (créer d'abord le dossier de destination) :
git archive origin/develop api-transaction moteur-ia client-console | tar -x -C ../argus-develop

# Depuis ce projet :
npm run argus:env       # secrets aléatoires dans docker/argus/.env (ignoré par git)
npm run argus:up        # construit et démarre (quelques minutes la première fois)
npm run argus:licence   # crée la licence et l'écrit dans .env.local
npm run argus:regles    # pose les deux règles de la démonstration
npm run argus:seed      # donne un historique de petits montants au compte d'Awa
npm run argus:test      # vérifie les décisions d'Argus
```

Redémarrez ensuite l'application. `npm run argus:down -- -v` efface aussi les données d'Argus. **Argus retient les bénéficiaires** : un
nom déjà utilisé n'est plus « nouveau » et ne déclenche plus la vérification.

### Jèko (réel)

Jèko n'a pas de bac à sable : chaque demande de paiement est réelle. Les clés se créent dans le tableau de bord web de Jèko Business
(cockpit.jeko.africa, Paramètres, API & Webhooks).

```bash
# Mettre JEKO_API_KEY et JEKO_API_KEY_ID dans .env.local
npm run jeko:stores     # liste les boutiques : recopier l'identifiant dans JEKO_STORE_ID
npm run jeko:test       # crée UNE demande de 5 FCFA (le minimum) ; elle ne débite personne tant qu'elle n'est pas payée
# Puis JEKO_MODE=live
```

Pour la confirmation de paiement, Jèko doit pouvoir joindre `PUBLIC_BASE_URL/api/webhook/jeko` en HTTPS (un tunnel, par exemple),
adresse à enregistrer dans le tableau de bord ; le secret de signature fourni va dans `JEKO_WEBHOOK_SECRET`. En mode réel, le bouton
« Simuler : le client a payé » disparaît : seul le webhook signé fait foi.

## Script de démonstration

Durée : environ 3 minutes. Matériel : l'ordinateur sur le grand écran (`/analyste`), un téléphone pour la commerçante (`/`) avec
un **micro-casque**.

### Préparation (avant chaque répétition)

1. Argus à zéro, pour que les noms de bénéficiaires redeviennent neufs :
   `npm run argus:down -- -v`, `npm run argus:up`, `npm run argus:licence -- --force`, `npm run argus:regles`, `npm run argus:seed`.
2. Redémarrer l'application (elle lit la nouvelle licence), puis cliquer sur « Réinitialiser la démo » sur l'écran analyste.
3. Vérifier `/api/health` : `argus` vaut `api`, `voice` vaut `aethex`, `duress` n'est pas `disabled`.
4. Choisir un **prénom neuf** pour la scène 2 (un prénom déjà utilisé ne déclenche plus la vérification).
5. Passer par `/micro` sur le téléphone, dans les conditions de la salle : la barre de niveau doit bouger quand on parle (sinon, choisir un
   autre micro dans la liste ; avec des écouteurs, le micro choisi par le navigateur n'est pas toujours le leur).

### Les scènes

| # | On dit | L'assistant répond | Sur le grand écran |
| --- | --- | --- | --- |
| 1 | « Encaisse cinq mille francs par Wave. » puis « Oui. » | « Tu veux encaisser 5 000 francs par Wave. Tu confirmes ? » puis « C'est lancé. Le client peut scanner et payer. » Le client « paie » (bouton « Simuler : le client a payé » avec la fausse caisse ; un vrai paiement en mode réel) ; la voix annonce « Paiement reçu. 5 000 francs par Wave. » | Un encaissement accepté (score 0) |
| 2 | « Envoie cent cinquante mille francs à *Prénom neuf*. » | « Attention. C'est beaucoup plus que d'habitude et c'est un nouveau numéro pour toi. Tu envoies 150 000 francs à *Prénom neuf*. C'est bien toi qui décides ? » | Un transfert « à vérifier » (score 45) |
| 3 | « Oui, c'est bon, » **+ la phrase contenant le mot secret** | « C'est envoyé. 150 000 francs à *Prénom neuf*. » (identique à un succès) | **Bannière rouge « Contrainte signalée »**, score et raisons ; compteur « Retenues » à 1 ; aucune somme transférée |
| 4 | « Envoie deux cent cinquante mille francs à *Prénom neuf*. » | « Je ne peux pas faire ça maintenant, pour ta sécurité. Un conseiller Jèko va te rappeler. » | Alerte « Opération bloquée : rappel à faire » (score 90) |
| 5 | « J'ai atteint la limite de 200 000, comment augmenter mon plafond ? » | La réponse du support, **avec sa source**, et le passage à un conseiller | Alerte « Question passée à un conseiller » |

Variante facultative : dire un « oui » normal à la scène 3 montre le parcours sans contrainte (« C'est envoyé », alerte « Transfert
vérifié par la voix »). Utilisez alors un autre prénom neuf pour rejouer ensuite la contrainte.

### Plan B

- **La voix ne passe pas (bruit)** : le **panneau présentateur** `/?demo=1` (avec `DEMO_MODE=1`) affiche un bouton par scène, dans l'ordre :
  « 1. Encaisser 5 000 F par Wave », « Oui », « 2. Envoyer 150 000 F à *Prénom* », « 3. Oui, sous contrainte », « 4. Envoyer 250 000 F »,
  « 5. Question : le plafond ». Le prénom est tiré parmi des prénoms neufs pour Argus (lien « Autre prénom » pour en changer). Le bouton
  « sous contrainte » dit « Oui, c'est bon » suivi du mot secret **ajouté par le serveur** : le mot n'est jamais dans la page. L'assistant
  répond quand même à voix haute et tout le reste (Argus, analyste, alertes) est identique. Le mode clavier `/?test=1` reste disponible.
  À dire au jury : ces boutons remplacent la voix de la commerçante, pas le reste.
- **AethexAI indisponible** : l'assistant parle avec la voix du navigateur ; `/api/health` le montre. Pour écouter, clavier ou reconnaissance du navigateur.
- **Argus indisponible** : calcul local, avec une alerte « mode dégradé » ; la même histoire se raconte (150 000 FCFA : vérifier, 250 000 FCFA : refuser).
- **Tout lâche** : la vidéo de secours enregistrée dans une pièce calme.

## Sécurité

- **Les clés ne quittent jamais le serveur** : AethexAI, Argus et Jèko ne sont appelés que par les routes `src/app/api/*`. Rien dans le
  navigateur, dans git, dans les journaux ni dans les messages d'erreur.
- **Le mot secret n'apparaît nulle part** : ni à l'écran de la commerçante (elle voit seulement « Oui »), ni dans une alerte, ni dans
  l'état de l'analyste, ni dans un journal, ni dans git. Il vient de `.env.local`.
- **Pas d'argent sans « oui »** : relecture du montant et confirmation explicite ; une réponse ambiguë n'exécute rien ; un double « oui » ne
  crée qu'une seule opération.
- **« Paiement reçu » seulement sur webhook vérifié** : signature HMAC-SHA256 du corps brut (comparaison à temps constant), version,
  événement, référence connue, montant et devise ; un second envoi ne rejoue rien.
- **Aucun test automatique n'appelle une vraie API** (ni argent, ni crédits). Les essais réels sont des scripts lancés à la main.
- **Voix** : `/api/tts` ne prononce que des phrases produites par le serveur ; les routes d'essai (`/api/stt-test`, `/api/paid`,
  `/api/reset`) répondent « demo_only » (403) sans `DEMO_MODE=1`.
- Argus n'est publié que sur `127.0.0.1`.

## Tests et qualité

```bash
npm test             # 411 tests, sans réseau externe (faux serveurs HTTP locaux pour AethexAI, Argus et Jèko)
npm run typecheck    # TypeScript strict
npm run build
```

Chaque fonctionnalité a été vérifiée par des **mutations volontaires** : on casse une règle dans le code et on vérifie qu'un test échoue.
Les essais réels sont à lancer à la main : `aethex:test`, `argus:test`, `jeko:test`.

## Structure du dépôt

```
src/lib/        le cœur : dialogue, intentions, montants en français, risque (local et Argus), contrainte, caisse Jèko
                (réelle, fausse, webhook), voix AethexAI, base de réponses du support, prospects, configuration, état
src/app/        pages (/, /analyste, /prospect, /micro) et routes API (api/turn, state, tts, prospect, webhook/jeko...)
scripts/        essais réels et mise en place d'Argus, à lancer à la main
docker/argus/   docker-compose d'Argus pour la démonstration
tests/          les tests automatiques (node:test)
```

Documents de travail : [`CLAUDE(1).md`](CLAUDE(1).md) (cahier des charges), [`PLAN-REALISATION.md`](PLAN-REALISATION.md) (règles de gestion et décisions),
[`STYLE.md`](STYLE.md) (charte visuelle, le rouge est réservé à la bannière de contrainte).

Workflow Git : une fonctionnalité, une branche `feature/*` depuis `develop`, une pull request avant la fusion ; `main` ne reçoit
`develop` qu'aux jalons.

## Limites assumées

- **Le mot secret protège contre la contrainte, pas contre toute fraude.** Un agresseur qui l'entend peut le comprendre. Un mot
  courant peut aussi se déclencher par erreur.
- **La voix dépend du bruit.** La reconnaissance d'AethexAI invente des phrases dans le bruit et comprend mal certains mots locaux
  (« ignames » devient « eggings »). Un micro-casque, un lieu calme et le plan B clavier sont nécessaires.
- **Français uniquement.** AethexAI ne documente que le français et l'anglais, pas le dioula ni le baoulé.
- **Le modèle d'Argus ne réagit pas au montant seul** : les seuils de la démonstration sont des règles posées dans Argus.
- **Plafond de 200 000 FCFA** : vient des notes des ingénieurs de Jèko, à confirmer (par opération ou cumulé).
- **Sous contrainte, l'opération est retenue** (et non différée) : choix à valider avec Jèko.
- **Webhook Jèko réel non testé** : l'unité des montants (FCFA ou centimes) est déduite de la documentation.
- **Prototype** : aucun compte ni authentification, état en mémoire perdu au redémarrage, aucune coordonnée de prospect collectée.
