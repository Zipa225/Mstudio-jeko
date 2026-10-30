# Script du PowerPoint : méthode PSI

Plan en trois temps : **P**roblématique, **S**olution, **I**mplémentation. Ce fichier donne, pour chaque diapositive : ce qu'on met
à l'écran, le visuel conseillé, et le texte à dire. Les questions du jury, le plan B de la démonstration et la liste du matin sont
dans [PITCH.md](PITCH.md). Le déroulé exact de la démo est dans le [README](README.md#script-de-démonstration).

## Le message à retenir

> **Awa n'a pas eu besoin de savoir lire, ni de crier, pour se protéger : la même voix qui fait marcher l'application la protège.**

## Vue d'ensemble

| # | Partie | Diapositive | Durée |
| --- | --- | --- | --- |
| 1 | | Titre | 0:15 |
| 2 | **P** | Awa, une commerçante du marché | 0:30 |
| 3 | **P** | Les trois problèmes que Jèko nous a donnés | 0:35 |
| 4 | **P** | Notre problématique | 0:20 |
| 5 | **S** | L'idée : une voix protégée par Argus | 0:30 |
| 6 | **S** | Les trois protections | 0:40 |
| 7 | **S** | Quand l'opération est bloquée, et au-delà de la fraude | 0:30 |
| 8 | **I** | Architecture | 0:40 |
| 9 | **I** | Ce qui est réel, ce qui est simulé | 0:35 |
| 10 | **I** | Démonstration en direct | 3:00 |
| 11 | **I** | Ce que la construction nous a appris | 0:35 |
| 12 | | Limites et suite | 0:40 |
| 13 | | Clôture | 0:15 |

Durée complète : environ 9 minutes. **Vérifiez le temps réel qui vous est accordé** et choisissez une version :

- **Version express (3 minutes)** : diapositives 2 (0:20), 4 (0:15), 6 (0:30), 10 (démo, 1:30), 12 (0:20), 13 (0:10). On saute les autres.
- **Version 5 minutes** : diapositives 1, 2, 4, 5, 6, 9, 10 (démo, 2:00), 12, 13.
- **Version complète** : les 13 diapositives.

Si le temps est court, on raccourcit la démo (scènes 1, 2 et 3 seulement), jamais le moment fort (le mot secret).

## Qui parle

Suggestion, d'après la répartition du projet. À adapter.

- **Emmanuel** : diapositives 5, 6, 7, 9 (Argus, mot secret, caisse, ce qui est réel) et la fin de la démo.
- **Le binôme** : diapositives 2, 3, 4, 8, 11 (le terrain, la voix, l'architecture) et la manipulation du téléphone d'Awa.
- **Ensemble** : 1, 12, 13.

## Charte du diaporama

- Reprendre les couleurs de l'application Jèko (`STYLE.md`) : violet `#3a0ca2` pour ce qui compte, fond gris clair `#f3f4f6`, cartes
  blanches, orange `#fed99d` pour les alertes, vert `#04af60` pour « connecté ». Police : Poppins, comme l'application.
- Une idée par diapositive. Pas plus de 4 lignes. Les chiffres en très grand.
- Une frise **P, S, I** en haut de chaque diapositive, avec la lettre du moment en violet et les autres en gris.
- Des vraies captures de l'application plutôt que des illustrations (liste ci-dessous).
- Aucun tiret long. Aucun chiffre qui n'a pas été mesuré.

### Captures à préparer avant

1. L'écran de la commerçante avec la relecture « Tu veux encaisser 5 000 francs par Wave. Tu confirmes ? » et les boutons Oui et Non.
2. Le QR affiché après le « oui » (partie simulation).
3. La bannière rouge « Contrainte signalée » sur `/analyste`, avec le score et les raisons.
4. L'historique d'Awa avec une opération « Bloquée » et le formulaire de vérification d'identité.
5. La page `/micro` (barre de niveau du micro).
6. Un schéma d'architecture à dessiner (voir la diapositive 8).

---

## 1. Titre

**À l'écran**
- **Jèko Voix, protégé par Argus**
- Hackathon M.Studio x AethexAI
- Les noms de l'équipe

**Visuel** : fond violet Jèko, le nom en blanc, le micro de l'application en grand.

**À dire** (0:15)
> « Bonjour. Nous sommes (vos noms). Pour la startup Jèko, nous avons construit un assistant vocal qui permet de gérer son argent
> sans savoir lire, et qui protège la commerçante quand on la force. »

---

# P : Problématique

## 2. Awa, une commerçante du marché

**À l'écran**
- **Awa** (personnage de notre démonstration)
- Vend des légumes au marché d'Adjamé
- Ne sait pas lire
- Encaisse avec Jèko

**Visuel** : un étal de marché (photo libre de droits ou illustration), le prénom en très grand. Une petite mention « personnage ».

**À dire** (0:30)
> « Voici Awa. C'est un personnage que nous avons imaginé, mais elle ressemble à des milliers de commerçantes d'Abidjan. Elle vend
> des légumes au marché d'Adjamé. Elle ne sait pas lire. Elle utilise Jèko pour encaisser ses clients.
> Le matin, tout va bien. Mais le soir, quelqu'un l'attend à la sortie du marché, et lui demande d'envoyer de l'argent. »

---

## 3. Les trois problèmes que Jèko nous a donnés

**À l'écran**
1. **Commander sans lire** : dire « encaisse 5 000 » et que l'application agisse
2. **Support et ventes** : une petite équipe, beaucoup de questions
3. **Fraude** : plus d'un million de transactions par mois, rien pour repérer les comportements bizarres

*(sous le 3) « D'après les ingénieurs de Jèko »*

**Visuel** : trois cartes blanches côte à côte, un chiffre ou une icône sur chacune. Seul « 1 million + » est un chiffre : il vient de Jèko, il faut le dire.

**À dire** (0:35)
> « Les ingénieurs de Jèko nous ont donné trois problèmes. Un : comment commander sans lire. Deux : comment répondre aux questions des
> visiteurs et des utilisateurs avec une équipe réduite. Trois : comment repérer la fraude, quand on traite plus d'un million de
> transactions par mois, selon eux, et qu'il n'y a rien aujourd'hui pour voir qu'un comportement est bizarre.
> Ils nous ont aussi dit aimer l'idée d'un code de contrainte, une phrase secrète, et ils nous ont proposé de le relier à la voix. »

---

## 4. Notre problématique

**À l'écran**
> **Comment permettre à une commerçante qui lit peu de gérer son argent par la voix, sans que cette même voix devienne un risque ?**

**Visuel** : la question seule, très grande, sur fond violet. Rien d'autre.

**À dire** (0:20)
> « Notre question est la suivante : comment permettre à une commerçante qui lit peu de gérer son argent par la voix, sans que cette
> voix devienne un risque ? Parce que parler à son téléphone, c'est aussi parler devant la personne qui vous force. »

*Cette diapositive est la charnière : on ne passe à la solution qu'après l'avoir dite lentement.*

---

# S : Solution

## 5. L'idée : une voix protégée par Argus

**À l'écran**
- **Un seul assistant vocal, protégé par Argus**
- La voix fait entrer Awa dans l'application
- C'est la même voix qui la protège

**Visuel** : le schéma simple « Awa, voix, assistant, Argus, caisse Jèko » en cinq pastilles reliées.

**À dire** (0:30)
> « Notre réponse tient en une idée : un seul assistant vocal, protégé par Argus. La voix fait entrer Awa dans l'application : elle
> dit sa demande, au lieu de la lire. Et c'est la même voix qui la protège : chaque opération passe par Argus, un moteur de score de
> risque, et Awa a un mot secret qu'elle peut glisser dans une phrase normale. Dans l'application Jèko, ce serait un bouton micro. »

---

## 6. Les trois protections

**À l'écran**
1. **Relire et confirmer** : l'assistant relit le montant, rien ne part sans un « oui »
2. **Argus décide** : accepter, vérifier, ou bloquer
3. **Le mot secret** : même écran de succès, rien n'est envoyé, l'analyste est alerté

**Visuel** : trois colonnes, avec en dessous la capture de la relecture (colonne 1), un score Argus (colonne 2) et la bannière rouge (colonne 3).

**À dire** (0:40)
> « Trois protections. La première : l'assistant relit toujours le montant et attend un « oui ». Aucune opération d'argent ne part
> sans cela. La deuxième : Argus examine chaque opération et décide. Si c'est inhabituel, par exemple un montant beaucoup plus gros
> que d'habitude vers un nouveau contact, l'assistant le dit à voix haute et demande confirmation. Si c'est trop risqué, il bloque.
> La troisième est notre moment fort : Awa peut dire son mot secret pendant la confirmation. Son écran affiche « C'est envoyé »,
> exactement comme d'habitude. Mais l'argent ne part pas, et l'analyste de Jèko voit une bannière rouge. »

---

## 7. Quand l'opération est bloquée, et au-delà de la fraude

**À l'écran**
- **Opération bloquée** : en attente dans l'historique, Awa la débloque en prouvant son identité
- **Support** : réponses avec leur source, sinon un conseiller
- **Prospects** : un visiteur est qualifié (chaud, tiède, froid)

**Visuel** : la capture de l'historique avec « Bloquée » et le bouton « Débloquer », et à côté la page `/prospect`.

**À dire** (0:30)
> « Quand Argus bloque, l'assistant ne rejette pas Awa : l'opération reste en attente dans son historique, et elle peut la débloquer
> en vérifiant son identité. Dans notre prototype, cette vérification est statique, nous n'avions pas le temps de faire un vrai KYC.
> Et la même voix répond au support : chaque réponse cite sa source, et quand l'assistant ne sait pas, il passe la main à un
> conseiller. Enfin, une page pour les futurs marchands les qualifie en quatre questions, sans collecter aucun contact. »

---

# I : Implémentation

## 8. Architecture

**À l'écran** (schéma)
- Awa → **AethexAI** (voix vers texte) → **Assistant** (compréhension, relecture) → **Argus** (score, décision) → **Caisse Jèko** → **AethexAI** (texte vers voix)
- En parallèle : **Écran analyste** (alertes en direct)
- Technique : Next.js 15, React 19, TypeScript strict. Argus en Docker (4 services)

**Visuel** : un schéma de gauche à droite, une pastille par brique, le trait de l'alerte vers l'analyste en rouge. Reprendre le tableau des quatre briques du projet : AethexAI = les oreilles et la bouche, l'assistant = le cerveau, Argus = le garde du corps, Jèko = la caisse.

**À dire** (0:40)
> « Voici comment ça marche. Awa parle. AethexAI transforme sa voix en texte. Notre assistant comprend la demande : il lit les montants
> en français, et il tolère les erreurs de prononciation courantes. Argus calcule un score et décide. L'assistant relit, attend le
> « oui », puis la caisse exécute, et AethexAI annonce le résultat à voix haute. En parallèle, tout ce qui compte arrive en direct
> sur l'écran de l'analyste.
> Chaque brique est branchée par une interface, donc on peut en remplacer une sans toucher au reste. Les clés ne quittent jamais le
> serveur. Et Argus, le vrai, tourne chez nous, dans Docker. »

---

## 9. Ce qui est réel, ce qui est simulé

**À l'écran**

| Réel | Simulé |
| --- | --- |
| La voix d'AethexAI (voix vers texte et texte vers voix) | Les transferts d'argent |
| Argus, en local avec son moteur et ses règles | Le marchand, son historique, ses contacts |
| La compréhension du français et le mot secret | Le paiement du client (bouton de simulation) |
| Les demandes de paiement avec l'API de Jèko (possible) | La vérification d'identité (KYC statique) |

**Visuel** : deux colonnes, vert à gauche, gris à droite. Aucune honte à montrer la colonne de droite : c'est notre crédibilité.

**À dire** (0:35)
> « Soyons clairs sur ce qui est réel. La voix est réelle : c'est l'API d'AethexAI. Argus est réel : il tourne chez nous avec son
> moteur, et nous avons posé deux règles pour la démonstration. La compréhension du français et le mot secret sont réels. Nous avons
> aussi créé de vraies demandes de paiement avec l'API de Jèko.
> Sont simulés : les transferts, qui n'envoient aucun argent, parce que Jèko n'a pas de mode test. Le marchand et son historique.
> Le paiement du client. Et la vérification d'identité. »

---

## 10. Démonstration en direct

**À l'écran**
- **Démonstration**
- *(en cas de problème : la vidéo de secours)*

**Visuel** : une diapositive presque vide, pour passer en plein écran sur les deux écrans : le téléphone d'Awa (page `/`) et le grand écran de l'analyste (`/analyste`).

**À dire** : (3:00 au total) suivre le tableau. L'opérateur dit les phrases d'Awa à voix haute avec un micro-casque. Le présentateur commente.

| Temps | Scène | Awa dit | L'assistant répond | Le présentateur dit |
| --- | --- | --- | --- | --- |
| 0:00 | 1. Encaisser | « Encaisse cinq mille francs par Wave. » puis « Oui. » | « Tu veux encaisser 5 000 francs par Wave. Tu confirmes ? » puis « C'est lancé. Le client peut scanner et payer. » | « Le matin, Awa encaisse en parlant. Le client scanne le QR de la boutique. » *(clic sur « Simuler : le client a payé »)* « Paiement reçu. » |
| 0:45 | 2. Le doute | « Envoie cent cinquante mille francs à (prénom neuf). » | « 150 000 francs pour (prénom). C'est beaucoup plus que d'habitude, et c'est un nouveau contact. Je l'envoie ? » | « Le soir, on la force. Argus voit que c'est inhabituel, et l'assistant le dit à voix haute. » |
| 1:15 | 3. Le mot secret | « Oui, c'est bon, » + une phrase avec son mot secret | « C'est envoyé. 150 000 francs à (prénom). » | « Regardez son téléphone : c'est un succès, comme d'habitude. L'agresseur ne voit rien. » *(montrer le grand écran)* « Mais voici l'écran de Karim : Contrainte signalée. L'argent n'est pas parti. » |
| 2:00 | 4. Le blocage | « Envoie deux cent cinquante mille francs à (prénom neuf). » | « Cette opération de 250 000 francs est en attente de vérification. Tu peux la débloquer dans ton historique. » | « Si l'agresseur insiste, Argus bloque. Awa ne perd rien : elle débloquera en prouvant qui elle est. » |
| 2:25 | 5. Le support | « J'ai atteint la limite de 200 000, comment augmenter mon plafond ? » | La réponse du support, avec sa source | « Et la même voix répond aux questions, en citant sa source. » |

*Facultatif, si le temps le permet : à la scène 4, « Débloquer » dans l'historique, la date de naissance et les 4 chiffres affichés sous le formulaire en démonstration, puis « oui » à la relecture.*

**Notes pour l'opérateur**
- Le prénom des scènes 2 à 4 doit être **neuf** pour Argus (le panneau `/?demo=1` en propose).
- Si la voix échoue, utiliser les boutons du panneau `/?demo=1` et dire la phrase du plan B de `PITCH.md`.
- Dire le mot secret à voix haute devant le jury fait partie de la scène : après la présentation, le **changer**.

---

## 11. Ce que la construction nous a appris

**À l'écran**
- **Le bruit** : la voix perd des mots → page de réglage du micro, tolérance aux erreurs de prononciation, plan B
- **Argus au démarrage** : refus à froid → délai du moteur porté de 150 ms à 1,5 s
- **Argus et les montants** : son modèle ne réagit pas au montant seul → deux règles posées
- **431 tests automatiques**, aucun n'appelle une vraie API

**Visuel** : quatre lignes « problème → ce que nous avons fait », en petit, avec le chiffre 431 en grand à droite. Éventuellement la capture de `/micro`.

**À dire** (0:35)
> « Construire ça nous a appris beaucoup. Premier point : le bruit. La reconnaissance vocale perd des mots dans un marché, donc nous
> avons une page de réglage du micro, une tolérance aux erreurs de prononciation courantes, par exemple « on voit » compris comme
> « envoie », et un mode de secours. Deuxième point : Argus refusait à froid, à cause d'un délai trop court, nous l'avons réglé.
> Troisième point : le modèle d'Argus ne réagit pas au montant seul, donc nous avons posé deux règles. Enfin, 431 tests
> automatiques, et pour les règles importantes, nous avons cassé le code volontairement pour vérifier qu'un test échoue. »

---

## 12. Limites et suite

**À l'écran**

| Nos limites | La suite |
| --- | --- |
| Le mot secret protège contre la contrainte, pas contre toute fraude | Le brancher sur le bouton micro de Jèko Business |
| La voix dépend du bruit | Valider avec Jèko : retenir ou différer sous contrainte ? Le plafond de 200 000, par opération ou cumulé ? |
| Français seulement | Un vrai KYC à la place du KYC statique |
| Prototype : pas de compte, pas de transfert réel | Les langues locales avec AethexAI |

**Visuel** : deux colonnes, orange pour les limites, violet pour la suite.

**À dire** (0:40)
> « Nos limites, dites franchement. Le mot secret protège contre la contrainte, pas contre toute fraude : un agresseur qui l'entend
> peut le comprendre. La voix dépend du bruit. Nous parlons français, pas encore les langues locales. Et ce n'est qu'un prototype :
> aucun compte, aucun vrai transfert.
> La suite : brancher cet assistant sur le bouton micro de Jèko Business, valider avec Jèko comment traiter une opération sous
> contrainte et comment fonctionne le plafond, remplacer notre vérification d'identité statique par un vrai KYC, et ajouter les langues locales. »

---

## 13. Clôture

**À l'écran**
> **Awa n'a pas eu besoin de savoir lire, ni de crier, pour se protéger.**

Merci. Les noms de l'équipe.

**Visuel** : fond violet, la phrase en blanc, très grande.

**À dire** (0:15)
> « Awa n'a pas eu besoin de savoir lire, ni de crier, pour se protéger. Merci. Nous sommes prêts pour vos questions. »

---

## À ne pas dire dans le diaporama

- « Intégré à Jèko » : c'est un prototype indépendant qui utilise leur API.
- « De l'argent réel a été transféré » : jamais, les transferts sont simulés.
- « Ça marche dans le bruit » : dire « nous avons un mode de secours ».
- « Argus détecte tout seul les gros montants » : ce sont deux règles posées pour la démonstration.
- « Le mot secret est inviolable » ou « le KYC est réel » : faux.
- Aucun chiffre de performance, de coût ou d'impact que nous n'avons pas mesuré.

Les réponses aux questions du jury sont dans [PITCH.md](PITCH.md#réponses-aux-questions-probables).
