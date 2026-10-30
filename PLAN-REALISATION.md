# Plan de réalisation : Jèko Voix protégé par Argus

Document de validation. Il complète le cahier des charges (`CLAUDE(1).md`) avec les contrats réels d'AethexAI, d'Argus (branche `develop`) et de Jèko.
Échéance : prototype vendredi 30 octobre 2026, présentation samedi 31 octobre 2026.

---

## 1. Ce qu'on construit

Une vendeuse parle, l'argent bouge (ou pas), et elle est protégée. En vrai, ce serait un bouton micro dans l'application Jèko Business. On ne peut pas modifier cette application : on construit donc **une page avec un micro qui la simule**, et tout le reste est réel.

```
 Page micro (simule Jèko Business)
        |  voix
        v
 [Notre serveur] --voix/texte--> AethexAI   (API : transcrire, parler)
        |        --transaction--> Argus      (API locale : score et décision)
        |        --paiement-----> Jèko       (API réelle : demande de paiement, webhook signé)
        v
 Écran de Karim (alertes, bannière « Contrainte signalée »)
```

Notre serveur est le chef d'orchestre : il comprend la commande, relit le montant, demande confirmation, appelle les trois API, et protège la vendeuse avec la phrase secrète.

## 2. Les systèmes et leur statut

| Système | Rôle | Branché sur | Secours si indisponible |
| --- | --- | --- | --- |
| Page micro | Simule le bouton micro de Jèko Business | À construire | Saisie au clavier (`?test=1`) |
| AethexAI | Voix vers texte, texte vers voix ivoirienne | API réelle, côté serveur | Voix du navigateur et clavier |
| Argus | Score de risque et décision sur chaque transfert | API locale (conteneurs), `POST /v1/transactions/score` | Score local simplifié, signalé à Karim |
| Jèko | Demande de paiement, webhook de confirmation | API réelle `api.jeko.africa` | Fausse caisse (tests et secours) |
| Écran de Karim | Alertes et opérations en direct | Déjà construit | Console Argus (option) |

---

## 3. Règles de gestion (le « quoi » et le « pourquoi »)

### Argent
- **RG-01** Aucune opération d'argent sans relecture du montant ET « oui » explicite de la vendeuse.
- **RG-02** Une réponse ambiguë (« oui non », « je ne confirme pas ») ne confirme rien : l'assistant redemande.
- **RG-03** Une nouvelle commande pendant la confirmation remplace l'ancienne et repasse par une relecture.
- **RG-04** Montant minimum 5 FCFA. Plafond 200 000 FCFA par transaction (à confirmer avec Jèko : par transaction ou cumulé).
- **RG-05** Les montants sont dits en lettres à la voix et affichés en chiffres à l'écran.

### Décision d'Argus
- **RG-06** Argus décide, nous exécutons sa décision. Elle est lue dans le champ `decision`, jamais déduite du code HTTP.
- **RG-07** `ALLOW` : relecture simple puis confirmation. `VERIFY` : l'assistant dit la raison du doute avant de demander le oui. `QUARANTINE` et `BLOCK` : refus poli, aucune opération, alerte « rappel à faire » pour Karim.
- **RG-08** Si le moteur ML d'Argus est en panne, Argus répond quand même et ne descend jamais sous `QUARANTINE` (repli « fail-closed ») : on le traite comme un refus, on ne contourne pas.
- **RG-09** Argus injoignable : on bascule sur le score local simplifié, on l'affiche à Karim (« mode dégradé »), jamais d'exécution sans score.
- **RG-10** Chaque tentative a un identifiant unique (Argus est idempotent : un rejeu renvoie `409`).
- **RG-11** Toutes les opérations, encaissements comme transferts, sont envoyées à Argus pour examen avant exécution (décision D2).

### Contrainte (le moment fort)
- **RG-12** La phrase secrète est dite pendant la confirmation, mêlée à une phrase normale. La détection est floue (tolère une erreur de transcription).
- **RG-13** Quand elle est détectée : la réponse et l'écran sont identiques à un succès, **rien n'est transféré**, l'opération passe à « retenue », une alerte critique part chez Karim avec le montant, le bénéficiaire, le score et les raisons.
- **RG-14** La phrase n'apparaît nulle part : ni à l'écran, ni dans une alerte, ni dans un journal, ni dans git. Elle vient de la configuration. Pas de phrase par défaut, et une phrase trop courte est refusée.
- **RG-15** La contrainte est un signal explicite : elle ne passe pas par le score d'Argus (même principe que dans la documentation d'Argus).
- **RG-16** Limite à dire franchement : un agresseur qui entend la phrase peut la comprendre. Elle protège contre la contrainte, pas contre toute fraude.

### Paiement
- **RG-17** « Paiement reçu » n'est annoncé qu'après un webhook Jèko dont la signature (HMAC-SHA256 du corps brut), le montant et la référence sont vérifiés. Un second envoi du même webhook n'annonce rien de plus.
- **RG-18** Pas d'environnement de test chez Jèko : tout test d'encaissement est réel. Montants minimes tant qu'on répète (minimum 5 FCFA).
- **RG-19** Les transferts réels sont **désactivés par défaut**. La scène de la contrainte et le refus à 250 000 n'appellent jamais Jèko : aucun argent ne bouge dans ces scènes.

### Secrets et pannes
- **RG-20** Les clés (AethexAI, Argus, Jèko) ne quittent jamais le serveur : ni navigateur, ni git, ni journaux.
- **RG-21** AethexAI indisponible : mode secours (clavier et voix du navigateur), annoncé clairement.
- **RG-22** Français uniquement (AethexAI ne documente que le français et l'anglais, pas le dioula ni le baoulé).

### Support (priorité 2)
- **RG-23** Une réponse du support cite sa source. Une question hors base passe à un humain avec un résumé.
- **RG-24** Un prospect est qualifié par quatre questions (activité, volume, moyens de paiement, ville). Règle chaud, tiède, froid écrite et documentée.

---

## 4. Règles d'implémentation (le « comment »)

### Architecture
- **RI-01** Chaque API externe est derrière une interface (un « port ») avec une implémentation réelle et une simulée : `Voice` (AethexAI), `Risk` (Argus), `Cashier` (Jèko). Le dialogue ne connaît que les ports.
- **RI-02** Le choix réel ou simulé se fait par configuration, au démarrage. Un état de santé (`/api/health`) dit ce qui est branché, sans jamais révéler une valeur.
- **RI-03** Les tests automatiques n'appellent **jamais** les vraies API (ni argent, ni crédits). Les tests réels sont des scripts séparés, lancés à la main.

### Configuration (`.env.local`, jamais dans git)
`AETHEX_API_KEY`, `AETHEX_BASE_URL`, `AETHEX_VOICE_ID`, `ARGUS_MODE` (`api` ou `local`), `ARGUS_URL`, `ARGUS_LICENSE_KEY`, `JEKO_MODE` (`mock` ou `live`), `JEKO_API_KEY`, `JEKO_API_KEY_ID`, `JEKO_STORE_ID`, `JEKO_WEBHOOK_SECRET`, `JEKO_ALLOW_TRANSFERS` (0 par défaut), `PUBLIC_BASE_URL`, `DURESS_PHRASE`, `DEMO_MODE`.

### Argus (contrat lu dans la branche `develop`)
- **RI-04** Appel : `POST {ARGUS_URL}/v1/transactions/score`, en-tête `X-License-Key`. Budget de latence : 300 ms, timeout côté nous 2 s.
- **RI-05** Corps envoyé : `transaction_id` (unique), `sender_account_id`, `beneficiary_account_id`, `amount`, `currency` (`XOF`), `timestamp` (ISO 8601), `transaction_channel` (`app`), `transaction_type` (`transfer` pour un envoi, `cash_in` pour un encaissement), `device_id`. Pour un encaissement, l'émetteur est le client (identifiant de démonstration) et le bénéficiaire est le compte d'Awa. Argus calcule lui-même l'historique et les agrégats : on n'envoie que des champs bruts.
- **RI-06** Réponse utilisée : `decision`, `risk_score`, `decision_reason`, `factors` (libellé, impact, rang), `model_version`. Les facteurs d'Argus remplacent nos six critères sur l'écran de Karim.
- **RI-07** Pour qu'un montant paraisse « inhabituel », Argus a besoin d'un historique du compte : un script de graine envoie quelques transactions passées d'Awa avant la démo.
- **RI-08** Les noms (« Koné ») sont résolus en numéros par un carnet de contacts de démo ; un contact inconnu d'Argus déclenche le critère « nouveau bénéficiaire ».

### Jèko (contrat lu sur developer.jeko.africa)
- **RI-09** Base `https://api.jeko.africa`, en-têtes `X-API-KEY`, `X-API-KEY-ID`. Montants en centimes (FCFA x 100).
- **RI-10** Demande de paiement : `POST /partner_api/payment_requests` avec `storeId`, `amountCents`, `currency`, `reference`, `paymentDetails: { type: "redirect", data: { paymentMethod, successUrl, errorUrl } }`. La réponse donne une `redirectUrl` où le client paie. Moyens : `orange`, `wave`, `mtn`, `moov`, `djamo`.
- **RI-11** Webhook : enregistré dans le tableau de bord Jèko (par entreprise ou par magasin), reçu sur une adresse publique HTTPS (tunnel). Signature vérifiée à temps constant sur le corps brut. Jèko réessaie 3 fois : le récepteur est idempotent.
- **RI-12** Transferts : `POST /partner_api/transfers` exige un bénéficiaire enregistré (`contactId`) ; le format détaillé n'est pas documenté. Ils restent simulés tant que ce n'est pas clarifié.
- **RI-13** Limite d'appels : 500 par minute par entreprise. Reprise avec attente croissante en cas d'erreur.

### AethexAI (contrat du cahier des charges, à vérifier à la première vraie réponse)
- **RI-14** Voix vers texte : `POST /transcribe`, multipart, champ `file` (WAV, FLAC ou Ogg/Opus, 8 Mio au plus), `language=french`. Texte vers voix : `POST /tts`, 650 caractères au plus, voix ivoirienne par défaut. En-tête `X-API-Key`, uniquement depuis le serveur.
- **RI-15** Navigateur : enregistrement par `MediaRecorder`, WAV 16 kHz, arrêt au silence, 12 secondes au plus. Le micro exige HTTPS (tunnel).
- **RI-16** Un script `scripts/test-aethex.ts` valide les vrais formats de réponse avant d'écrire le reste.

### Qualité et livraison
- **RI-17** Une branche par fonctionnalité depuis `develop`. Tests verts, typecheck propre, build, puis fusion. Aucun push sans votre accord.
- **RI-18** Chaque règle de sécurité a un test qui échoue si on la casse (contrôle de mutation).
- **RI-19** Avant la démo : HTTPS, vidéo de secours, remise à zéro entre deux répétitions (la règle de rafale compte les opérations des 10 dernières minutes).

---

## 5. Workflow à suivre, dans l'ordre

| # | Étape | Qui | Fini quand |
| --- | --- | --- | --- |
| 0 | Prérequis : Argus lancé, clés Jèko, clé AethexAI, phrase secrète, tunnel | Vous | Voir la liste du paragraphe 6 |
| 1 | Page micro : l'écran de la vendeuse (micro, Oui/Non, réponse en gros) sur le serveur existant | Moi | La démo passe au clavier sur un téléphone |
| 2 | Voix AethexAI : script de test réel, transcrire, parler, secours | Moi | « Encaisse cinq mille francs par Wave » est compris, et la voix répond |
| 3 | Argus : port `Risk`, client, graine d'historique, repli local | Moi | Un transfert de 150 000 donne `VERIFY`, 250 000 donne `QUARANTINE` ou `BLOCK`, avec facteurs |
| 4 | Jèko réel : client de paiement, webhook public, transferts désactivés | Moi | Un paiement de 5 FCFA déclenche le webhook, vérifié, puis « Paiement reçu » |
| 5 | Moment fort de bout en bout : voix, phrase secrète, bannière de Karim | Ensemble | La scène passe sur téléphone, avec du bruit autour |
| 6 | Support et prospects (priorité 2, si le temps le permet) | Moi | Une question reçoit une réponse sourcée |
| 7 | Gel, README et script de démo, vidéo de secours, répétition chronométrée | Ensemble | La démo tourne sur le matériel de la présentation |

Calendrier : **mercredi soir** étapes 0 et 1. **Jeudi** étapes 2, 3, 4, puis 5 ; gel le soir. **Vendredi** étapes 6 (si possible) et 7, livraison. **Samedi** présentation.

## 6. Ce que vous devez faire ou fournir

1. **Argus** : dans le dossier `true-argus`, passer sur la branche `develop` (le dossier est actuellement sur `main`, en retard), renseigner `.env` (dont `ADMIN_EMAIL` et `ADMIN_PASSWORD`), lancer `docker compose up`. Se connecter à la console (port 5050), créer une **clé de licence** (`POST /v1/licenses`, réservé à l'administrateur). L'API répond sur le port 4040.
2. **Jèko** : application Jèko Business, créer le compte marchand, générer `X-API-KEY` et `X-API-KEY-ID` (affichée une seule fois), noter le `storeId` (`GET /partner_api/stores`), enregistrer l'adresse du webhook, noter le secret de signature.
3. **AethexAI** : la clé, avec des crédits.
4. **La phrase secrète** de la démo, d'au moins deux mots de quatre lettres ou plus.
5. **Un tunnel HTTPS** (cloudflared ou ngrok) pour le micro du téléphone et le webhook Jèko.
6. Mettre tout cela dans `.env.local` (jamais dans git, jamais dans une conversation).

## 7. Décisions

- **D1 validée** Argus rend quatre décisions. `QUARANTINE` est traité comme `BLOCK` dans la démo (refus poli et alerte de rappel).
- **D2 validée, modifiée** Toutes les transactions (encaissements et transferts) sont envoyées à Argus pour examen.
- **D3 validée** Transferts réels désactivés pour toute la démo.
- **D4 ouverte** Les encaissements de la démo passent par le vrai Jèko. Garder « cinq mille francs » (de vrais francs entre vos propres comptes) ou prendre un petit montant pour répéter ?
- **D5 validée** L'écran de Karim reste le nôtre. La console d'Argus (port 5050) peut s'ajouter à côté pour montrer le score.
- **D6 validée (option)** Faire apparaître la contrainte aussi dans Argus (dossier de fraude) seulement s'il reste du temps.

## 8. Workflow Git

Une fonctionnalité, une branche `feature/*` depuis `develop`. Avant chaque fusion dans `develop` : une Pull Request, avec les tests, le typecheck et le build verts. `main` ne reçoit `develop` qu'aux jalons.
