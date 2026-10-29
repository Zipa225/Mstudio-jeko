# Pitch de la présentation (samedi 31 octobre)

Durée : **environ 3 minutes de discours et de démonstration**, puis les questions. Ce fichier contient le texte à dire, le minutage,
ce qu'on fait à l'écran, les réponses aux questions probables, ce qu'il ne faut pas dire, et la liste du matin. Les phrases d'Awa et les
réponses de l'assistant sont celles du script de démonstration du [README](README.md#script-de-démonstration).

## Le message à retenir (une phrase)

> **Awa n'a pas eu besoin de savoir lire, ni de crier, pour se protéger : la même voix qui fait marcher l'application la protège.**

Trois choses à faire sentir au jury : la voix qui remplace la lecture, Argus qui regarde chaque opération, et le mot secret qui
signale une contrainte sans que l'agresseur voie quoi que ce soit.

## Qui fait quoi

Deux personnes, deux rôles. Ça évite de parler et de manipuler en même temps.

- **Le présentateur** parle, suit le texte, regarde le jury.
- **L'opérateur** tient le téléphone d'Awa (page `/`) avec un micro-casque et dit les phrases d'Awa à voix haute. Il a le panneau
  `/?demo=1` ouvert dans un second onglet pour le plan B.
- Le grand écran montre `/analyste` en continu.

## Minutage et texte à dire

Phrases courtes, à dire calmement. Les passages en *italique* sont les phrases d'Awa, dites à voix haute par l'opérateur.

### 0:00 - 0:20 L'accroche

« Voici Awa. Elle vend des légumes au marché d'Adjamé. Elle ne sait pas lire. Pour encaisser, elle utilise Jèko.
Et ce soir, quelqu'un l'attend à la sortie du marché. »

*À l'écran : la page de la commerçante, bouton micro.*

### 0:20 - 0:50 Le problème et notre réponse

« Jèko nous a donné trois problèmes. Un : comment commander sans lire. Deux : comment répondre aux questions avec une petite équipe.
Trois : comment repérer la fraude parmi plus d'un million de transactions par mois.

Notre réponse tient en une idée : un assistant vocal, protégé par Argus. La voix fait entrer Awa dans l'application, et c'est la même
voix qui la protège. »

### 0:50 - 1:20 Scène 1 : encaisser sans lire

« Le matin, Awa encaisse en parlant. »

*Awa : « Encaisse cinq mille francs par Wave. »*

« L'assistant relit le montant. Rien ne part sans son accord. »

*L'assistant : « Tu veux encaisser 5 000 francs par Wave. Tu confirmes ? »*
*Awa : « Oui. »*

« Le client paie, et l'assistant annonce : paiement reçu. Awa n'a pas lu un seul mot. »

### 1:20 - 2:10 Scènes 2 et 3 : le moment fort

« Le soir, on la force à envoyer de l'argent. »

*Awa : « Envoie cent cinquante mille francs à (prénom neuf). »*

« Argus regarde l'opération : c'est beaucoup plus que d'habitude, et c'est un nouveau contact. L'assistant le dit à voix haute, puis
demande s'il envoie. »

*L'assistant : « 150 000 francs pour (prénom neuf). C'est beaucoup plus que d'habitude, et c'est un nouveau contact. Je l'envoie ? »*

« Awa ne peut pas crier. Alors elle répond normalement, et elle glisse son mot secret dans sa phrase. »

*Awa : « Oui, c'est bon, » suivi d'une phrase qui contient le mot secret.*

« Regardez son téléphone : "C'est envoyé". Exactement comme d'habitude. L'agresseur ne voit rien de suspect.
Et maintenant, regardez l'écran de Karim, l'analyste de Jèko. »

*Montrer le grand écran : la bannière rouge « Contrainte signalée », le montant, le bénéficiaire, le score et les raisons.*

« L'alerte est partie. L'argent, lui, n'est pas parti : l'opération est retenue. Et le mot secret n'apparaît ni sur l'écran d'Awa ni dans l'alerte. »

### 2:10 - 2:30 Scènes 4 et 5 : refuser, répondre

« Si l'agresseur insiste avec 250 000 francs, Argus bloque l'opération. L'écran d'Awa ne la rejette pas : elle la retrouve dans son historique, marquée « Bloquée ». Pour la débloquer, Awa doit prouver qui elle est. »

*Awa : « Envoie deux cent cinquante mille francs à (prénom neuf). »*
*L'assistant : « Cette opération de 250 000 francs est en attente de vérification. Tu peux la débloquer dans ton historique. »*
*(Facultatif, si le temps le permet : « Débloquer », date de naissance et 4 chiffres de la pièce, puis « oui » à la relecture.)*

« Et si Awa a une question, l'assistant répond en citant sa source, ou passe la main à un conseiller. »

*Awa : « J'ai atteint la limite de 200 000, comment augmenter mon plafond ? »*

### 2:30 - 2:50 Ce qui est réel, ce qui est simulé

« Soyons clairs sur ce que vous avez vu. Est réel : la voix d'AethexAI, Argus qui tourne chez nous avec son moteur et ses règles, la
compréhension du français, la détection du mot secret. Nous avons aussi créé de vraies demandes de paiement avec l'API de Jèko.
Est simulé : la commerçante et son historique, et les transferts, qui n'envoient aucun argent. »

### 2:50 - 3:10 Nos limites, et la suite

« Nos limites : le mot secret protège contre la contrainte, pas contre toute fraude. La voix dépend du bruit : nous avons prévu un
mode de secours. Et nous parlons français, pas encore les langues locales.

La suite : brancher cet assistant sur le bouton micro de Jèko Business, et valider avec Jèko comment traiter une opération sous contrainte. »

### 3:10 La clôture

« Awa n'a pas eu besoin de savoir lire, ni de crier, pour se protéger. Merci. »

## Plan B pendant la démonstration

| Ce qui arrive | Ce qu'on fait | Ce qu'on dit |
| --- | --- | --- |
| La voix ne comprend pas une phrase | L'opérateur appuie sur le bouton de la scène dans le panneau `/?demo=1` | « En salle bruyante, nous gardons ces boutons : ils remplacent la voix d'Awa, pas le reste. Argus, l'analyste et les alertes sont les mêmes. » |
| Le micro ne capte rien | Panneau `/?demo=1` pour toute la suite | Même phrase, sans s'excuser longuement. |
| Argus bloque une opération normale | Rejouer une fois, sinon bouton suivant | « Argus est prudent : il bloque dans le doute, et on peut débloquer en vérifiant l'identité. » |
| Plus rien ne s'affiche | Lancer la vidéo de secours | « Voici la même démonstration enregistrée. » |

Ne pas improviser une explication technique devant le jury quand ça rate : une phrase, le plan B, on continue.

## Réponses aux questions probables

Réponses courtes et honnêtes. « Nous ne savons pas encore » vaut mieux qu'une réponse inventée.

**« Et si l'agresseur connaît le mot secret ? »**
Alors il peut éviter de le dire : le mot protège contre la contrainte, pas contre toute fraude. C'est une limite que nous assumons.
Argus examine quand même chaque opération, indépendamment du mot.

**« Et si la commerçante dit le mot par hasard ? »**
L'opération est retenue et un conseiller est prévenu : on perd un transfert, pas de l'argent. C'est pourquoi on choisit un mot ou une
phrase peu courante. L'écran de l'analyste signale d'ailleurs un secret qui n'est qu'un seul mot court.

**« Pourquoi retenir l'opération plutôt que la différer ? »**
C'est un choix de prototype que nous voulons valider avec Jèko. Retenir garantit que rien ne bouge pendant que l'analyste vérifie.

**« Et le dioula, le baoulé ? »**
Aujourd'hui, français seulement. C'est la première extension à demander à notre fournisseur de voix.

**« La voix marche dans le bruit d'un marché ? »**
C'est notre point faible, nous l'avons mesuré : la reconnaissance perd des mots quand il y a du bruit ou que le micro sature. Nous avons une
page de réglage du micro, une tolérance aux erreurs de prononciation courantes (« on voit » compris comme « envoie ») et un mode de
secours. Un micro près de la bouche change tout.

**« Comment ça s'intègre à Jèko ? »**
L'assistant est un service côté serveur qui s'appuie sur trois interfaces : la voix, le risque, la caisse. Dans Jèko Business, il faudrait un
bouton micro qui envoie le son à ce service. Côté Jèko, nous utilisons déjà leur API pour créer des demandes de paiement. Les transferts
sont simulés : nous ne les avons pas branchés.

**« Argus est-il vraiment utilisé ? »**
Oui : Argus tourne chez nous dans Docker, avec son moteur et son API, et chaque opération lui est soumise. Précision honnête : nous avons
posé deux règles pour la démo, vérifier à partir de 100 000 francs vers un nouveau numéro, refuser au-dessus de 200 000.

**« Le déblocage, c'est un vrai KYC ? »**
Non, c'est un KYC statique : deux informations fixes (date de naissance, quatre derniers chiffres de la pièce) pour montrer le parcours. Un vrai
déblocage passerait par le dossier de vérification de Jèko. Même après un déblocage réussi, Awa doit encore entendre la relecture et dire « oui ».

**« Et si quelqu'un devine ces informations ? »**
Trois essais seulement : au troisième échec l'opération reste bloquée et l'analyste est alerté. Deux informations fixes restent faibles : c'est une limite
du prototype, que le vrai KYC de Jèko lèverait.

**« Pourquoi 200 000 francs ? »**
C'est le plafond que nous avons retenu pour la démonstration. Nous ne savons pas encore s'il est par opération ou cumulé : c'est une de nos
deux questions à Jèko.

**« Combien ça coûte ? »**
Nous ne l'avons pas chiffré. Chaque tour de parole fait appel à la voix d'AethexAI, qui est facturée ; Argus est auto-hébergé. Le chiffrage est une
prochaine étape.

**« Et les données personnelles ? »**
Le son est envoyé à AethexAI pour être transcrit. Les fiches de prospects ne contiennent aucun contact : un vrai rappel demanderait un
consentement explicite.

**« Que se passe-t-il si Argus ou la voix tombe ? »**
Si Argus est injoignable, un calcul local de secours prend le relais et l'analyste reçoit une alerte « mode dégradé ». Si la voix d'AethexAI ne
répond pas, l'assistant parle avec la voix du navigateur, et on peut taper au clavier.

**« Est-ce fiable ? »**
Le projet a 431 tests automatiques, et pour chaque règle importante nous avons cassé le code volontairement pour vérifier qu'un test échoue.
Aucun test n'appelle une vraie API. Cela dit, la voix réelle dépend du micro et du bruit, et ça, un test ne le garantit pas.

**« Quel modèle économique ? »**
Nous ne l'avons pas défini : c'est à Jèko de décider. La valeur vient de la fraude évitée et du temps de support économisé.

## Ce qu'il ne faut PAS dire

- « C'est intégré à Jèko » : non, c'est un prototype indépendant qui utilise leur API.
- « De l'argent réel a été transféré » : jamais. Les transferts sont simulés.
- « Ça marche dans le bruit » : faux. Dire « nous avons un mode de secours ».
- « Ça comprend le dioula » : faux.
- « Argus détecte tout seul les gros montants » : faux, ce sont deux règles posées pour la démo.
- « Le mot secret est inviolable » : faux. Dire ce qu'il protège et ce qu'il ne protège pas.
- « Le KYC est réel » : faux, il est statique (deux informations fixes).
- Aucun chiffre de performance ni statistique non mesurée. Le seul chiffre repris est « plus d'un million de transactions par mois »,
  **attribué à Jèko** (« Jèko nous a dit »).

## Le mot secret

- Il a été écrit dans une conversation de travail : **changez-le avant la présentation** (`DURESS_PHRASE` dans `.env.local`), puis
  redémarrez l'application et vérifiez `/api/health`.
- Choisissez-en un que vous n'avez écrit nulle part ailleurs.
- Le public l'entend pendant la scène 3 : il n'est plus secret ensuite. Le **changer encore après la présentation**.

## Liste du matin

À faire dans cet ordre, au moins une heure avant de passer.

1. **Argus à zéro** : `npm run argus:down -- -v`, `npm run argus:up`, `npm run argus:licence -- --force`, `npm run argus:regles`,
   `npm run argus:seed`.
2. **Changer le mot secret**, lancer l'application, puis cliquer sur « Réinitialiser la démo » sur l'écran analyste.
3. `/api/health` : `argus` vaut `api`, `voice` vaut `aethex`, `duress` n'est pas `disabled`.
4. **Micro-casque branché**, puis `/micro` sur l'appareil de la démo, dans la salle : la barre de l'étape 1 bouge quand on parle et aucun essai n'est « saturé ».
5. **Chauffer Argus** : le premier appel est plus lent ; jouer un encaissement avant de passer, puis réinitialiser la démo.
6. **Choisir un prénom neuf** pour les scènes 2 à 4 (le panneau `/?demo=1` en tire un).
7. **Répéter la démo en entier une fois, au chrono**, puis remettre Argus à zéro (étape 1) et réinitialiser la démo.
8. Téléphone en « ne pas déranger », luminosité à fond, grand écran en plein écran sur `/analyste`.
9. **Vidéo de secours** ouverte dans un onglet.

## Si la démo rate

- Ne pas s'excuser. Une phrase : « Je passe à la version enregistrée. » Puis la vidéo.
- Si le grand écran ne répond pas, décrire ce qu'on devrait y voir : la bannière rouge, le montant, le bénéficiaire, le score.

## Après la présentation

- Changer le mot secret.
- Régénérer les clés AethexAI et Jèko (elles ont été collées dans une conversation).
- Couper le tunnel s'il est encore ouvert.
