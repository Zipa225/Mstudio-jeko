# Script du PowerPoint : méthode PSI

Plan en trois temps : **P**roblématique, **S**olution, **I**mplémentation. On commence par une histoire vraie, dite simplement, pour que
même quelqu'un qui n'est pas technique comprenne. Ce fichier donne, pour chaque diapositive : ce qu'on met à l'écran, le visuel
conseillé, et le texte à dire. Les questions du jury, le plan B de la démonstration et la liste du matin sont dans [PITCH.md](PITCH.md).
Le déroulé exact de la démo est dans le [README](README.md#script-de-démonstration).

## Le message à retenir

> **Awa n'a pas eu besoin de savoir lire, ni de crier, pour se protéger : la même voix qui fait marcher l'application la protège.**

## Vue d'ensemble

| # | Partie | Diapositive | Durée |
| --- | --- | --- | --- |
| 1 | | Titre | 0:15 |
| 2 | **P** | L'histoire de la maman de Yamoussoukro | 1:10 |
| 3 | **P** | Notre problématique | 0:15 |
| 4 | **S** | Argus Voice | 0:30 |
| 5 | **S** | Les fonctionnalités phare | 0:50 |
| 6 | **I** | Architecture | 0:40 |
| 7 | **I** | Ce qui est réel, ce qui est simulé | 0:35 |
| 8 | **I** | Démonstration en direct | 3:00 |
| 9 | **I** | Ce que la construction nous a appris | 0:35 |
| 10 | | Limites et suite | 0:40 |
| 11 | | Clôture | 0:15 |

Durée complète : environ 9 minutes. **Vérifiez le temps réel qui vous est accordé** et choisissez une version :

- **Version express (3 minutes)** : diapositives 2 (0:45, sans les phrases entre crochets), 5 (0:35), 8 (démo, scènes 1 à 3, 1:15), 10 (0:15) et 11 (0:10).
- **Version 5 minutes** : diapositives 1, 2, 4, 5, 8 (démo, 1:45), 10 et 11.
- **Version complète** : les 11 diapositives.

Si le temps est court, on raccourcit la démo (scènes 1, 2 et 3 seulement), jamais le moment fort (le mot secret).

**Si la démonstration rate :** la diapositive 5 a déjà dit tout ce que fait l'application. On revient dessus, on montre les captures d'écran,
et on dit : « Voici ce que vous auriez vu. » Voir le plan B dans [PITCH.md](PITCH.md).

## Qui parle

Suggestion, d'après la répartition du projet. À adapter.

- **Celui qui a vécu l'histoire** : diapositives 2 et 3.
- **Emmanuel** : diapositives 4, 5, 7 (Argus, mot secret, ce qui est réel) et la fin de la démo.
- **Le binôme** : diapositives 6 et 9 (l'architecture, la voix) et la manipulation du téléphone de la maman.
- **Ensemble** : 1, 10, 11.

## Charte du diaporama

- Reprendre les couleurs de l'application Jèko (`STYLE.md`) : violet `#3a0ca2` pour ce qui compte, fond gris clair `#f3f4f6`, cartes
  blanches, orange `#fed99d` pour les alertes, vert `#04af60` pour « connecté ». Police : Poppins, comme l'application.
- Une idée par diapositive. Pas plus de 4 lignes. Les chiffres en très grand.
- Une frise **P, S, I** en haut de chaque diapositive, avec la lettre du moment en violet et les autres en gris.
- Des vraies captures de l'application plutôt que des illustrations (liste ci-dessous).
- Des phrases courtes, faciles à lire à voix haute. Aucun tiret long. Aucun chiffre qui n'a pas été mesuré.

### Captures à préparer avant

1. L'écran de la commerçante avec la relecture « Tu veux encaisser 5 000 francs par Wave. Tu confirmes ? » et les boutons Oui et Non.
2. Le QR affiché après le « oui » (partie simulation).
3. La bannière rouge « Contrainte signalée » sur `/analyste`, avec le score et les raisons.
4. L'historique avec une opération « Bloquée » et le formulaire de vérification d'identité.
5. La page `/micro` (barre de niveau du micro).
6. Le tableau de bord de la console web d'Argus (`npm run argus:console`), après quelques opérations.
7. Un schéma d'architecture à dessiner (voir la diapositive 6).

---

## 1. Titre

**À l'écran**
- **Argus Voice** (ou « Jèko Voix protégé par Argus » : choisir un seul nom et le garder partout)
- Hackathon M.Studio x AethexAI
- Les noms de l'équipe

**Visuel** : fond violet Jèko, le nom en blanc, le micro de l'application en grand.

**À dire** (0:15)
> « Bonjour. Nous sommes (vos noms). Nous allons vous raconter une histoire, puis vous montrer ce que nous avons construit pour
> la startup Jèko. »

---

# P : Problématique

## 2. L'histoire de la maman de Yamoussoukro

**À l'écran**
- Une seule phrase, en très grand : **« Je ne sais pas lire, ils vont venir m'arnaquer. »**
- En petit : *Yamoussoukro, le week-end dernier*

**Visuel** : un étal de marché, sans visage reconnaissable. Pas de texte long : la phrase de la maman suffit.

**À dire** (1:10). Texte à lire tel quel, avec des pauses après chaque phrase de la maman.
> « Le week-end dernier, je me suis rendu à Yamoussoukro pour un mariage. Comme dans mes habitudes ici à Abidjan, je paie tout par
> Mobile Money.
> J'avais fini de prendre mes produits, et en voulant payer, j'ai dit que j'allais payer par Wave ou autre Mobile Money.
> La dame m'a aussitôt dit : « Mon fils, je ne prends pas Wave ni autre Mobile Money. »
>
> J'étais choqué. Je voulais savoir pourquoi, jusque-là, elle n'avait pas adopté ce moyen de paiement. Alors je pose la question, et
> elle me dit : « Mon fils, je ne sais ni lire ni écrire. En plus, il ne faut pas : ils vont venir m'arnaquer. »
>
> Mon collègue et moi, nous avons décidé de nous pencher sur cette idée. [Parce que beaucoup de nos mamans qui tiennent le
> commerce ne savent ni lire ni écrire, et savent à peine manipuler les applications.]
>
> Ça nous a permis de sortir deux problèmes. Un : elles ne savent pas lire, donc l'application est difficile pour elles. Deux : elles ont
> peur de se faire arnaquer, ou forcer. »

**Notes**
- Les phrases entre crochets se coupent dans la version express.
- Le chiffre « plus de 30 % de la population en Afrique » n'est **pas** dans le texte : il n'a pas de source vérifiée. Si vous en avez une,
  ajoutez-le après la phrase entre crochets et citez la source à voix haute.
- L'histoire doit être vraie telle que vous la racontez : le jury peut vous poser une question dessus.
- Pour la démonstration, dites une phrase : « Pour la démonstration, nous appellerons cette maman Awa. » Cela protège la vraie personne.

---

## 3. Notre problématique

**À l'écran**
> **Comment aider une maman qui ne sait pas lire à gérer son argent, et la protéger si on essaie de la tromper ou de la forcer ?**

**Visuel** : la question seule, très grande, sur fond violet.

**À dire** (0:15)
> « Notre question est simple : comment aider une maman qui ne sait pas lire à gérer son argent avec sa voix, et comment la protéger
> si on essaie de la tromper ou de la forcer ? C'est d'ailleurs l'un des problèmes que Jèko nous a donnés : commander sans lire. »

---

# S : Solution

## 4. Argus Voice

**À l'écran**
- **Argus Voice**
- Argus : le géant aux cent yeux de la mythologie grecque
- Il voit tout et il veille. Maintenant, il parle.

**Visuel** : le logo ou le nom en grand, et à côté un œil stylisé violet (ou la lettre A avec un œil).

**À dire** (0:30)
> « Pour parer à cela, nous avons Argus Voice.
> Argus, c'est un géant de la mythologie grecque, avec cent yeux. Il voit tout et il veille.
> Ici, Argus veille sur chaque opération d'argent. Et maintenant, il parle : il guide la maman avec sa voix.
> Dans l'application Jèko, ce serait un simple bouton micro.
>
> Nous allons vous présenter les fonctionnalités. Mais comme dit l'adage ivoirien : parler parler trop donne dabgai. Passons à la
> présentation de la solution. »

**Note** : « dabgai » est écrit comme dans votre texte. Vérifiez l'orthographe avec quelqu'un de chez vous avant de la mettre à l'écran.
Argus n'est **pas** un dieu : ne dites pas « dieu grec », un juré pourrait le corriger.

---

## 5. Les fonctionnalités phare

**À l'écran** (six cartes, une icône et deux ou trois mots chacune)
1. **Je parle, il comprend** : « Encaisse 5 000 francs par Wave »
2. **Rien ne part sans mon « oui »** : il répète le montant avant d'agir
3. **Argus surveille** : normal, bizarre ou trop risqué
4. **Le mot secret** : on me force, je le dis, l'écran fait comme si tout allait bien
5. **Mon historique** : payé, envoyé, bloqué, et je débloque en prouvant qui je suis
6. **Je pose mes questions** : réponse avec sa source, sinon un conseiller

En bas, en violet : **Pour Jèko** : un écran qui montre tout en direct, avec une alerte rouge quand une maman est forcée.

**Visuel** : les six cartes en grille 3 sur 2, avec en fond très léger la capture de l'écran de la commerçante.

**À dire** (0:50). Phrases courtes, une carte après l'autre.
> « Voici ce que fait Argus Voice.
> Un : on commande avec la voix. La maman dit « encaisse cinq mille francs par Wave », et l'application comprend, même avec les façons
> de parler de tous les jours.
> Deux : l'application répète le montant avant d'agir. Rien ne part sans son « oui ».
> Trois : Argus regarde chaque opération. Si c'est normal, ça passe. Si c'est bizarre, l'application le dit à voix haute et demande si elle est
> sûre. Si c'est trop risqué, l'opération est bloquée.
> Quatre : le mot secret. Si on la force, elle le glisse dans sa phrase. Son écran affiche « C'est envoyé », comme d'habitude. Mais l'argent
> ne part pas, et Jèko est prévenu tout de suite.
> Cinq : l'historique. Elle voit ses opérations : payé, envoyé, bloqué. Et si une opération est bloquée, elle peut la débloquer en prouvant
> qui elle est.
> Six : elle pose ses questions, et l'assistant dit d'où vient sa réponse. S'il ne sait pas, il passe la main à un conseiller.
> Et pour Jèko, un écran montre tout en direct, avec une alerte rouge quand une maman est forcée. »

**Notes**
- C'est la diapositive à laquelle on revient si la démonstration rate.
- Version express (0:35) : dire seulement 1, 2, 4 et la phrase « pour Jèko ».
- Ne dites rien que la démonstration ne montre pas : tout ce qui est dans cette liste existe dans l'application. La vérification d'identité est
  statique, et vous le dites à la diapositive 7.

---

# I : Implémentation

## 6. Architecture

**À l'écran** (schéma)
- Maman → **AethexAI** (voix vers texte) → **Assistant** (compréhension, relecture) → **Argus** (score, décision) → **Caisse Jèko** → **AethexAI** (texte vers voix)
- En parallèle : **Écran analyste** (alertes en direct)
- Technique : Next.js 15, React 19, TypeScript strict. Argus en Docker (4 services)

**Visuel** : un schéma de gauche à droite, une pastille par brique, le trait de l'alerte vers l'analyste en rouge. Reprendre les quatre briques du projet : AethexAI = les oreilles et la bouche, l'assistant = le cerveau, Argus = le garde du corps, Jèko = la caisse.

**À dire** (0:40)
> « Voici comment ça marche. La maman parle. AethexAI transforme sa voix en texte. Notre assistant comprend la demande : il lit les montants
> en français, et il comprend les façons de parler courantes. Argus calcule un score et décide. L'assistant répète, attend le « oui »,
> puis la caisse exécute, et AethexAI annonce le résultat à voix haute. En parallèle, tout ce qui compte arrive en direct sur l'écran de
> l'analyste.
> Chaque brique est branchée par une interface, donc on peut en remplacer une sans toucher au reste. Les clés ne quittent jamais le
> serveur. Et Argus, le vrai, tourne chez nous, dans Docker. »

---

## 7. Ce qui est réel, ce qui est simulé

**À l'écran**

| Réel | Simulé |
| --- | --- |
| La voix d'AethexAI (voix vers texte et texte vers voix) | Les transferts d'argent |
| Argus, en local avec son moteur et ses règles | La commerçante, son historique, ses contacts |
| La compréhension du français et le mot secret | Le paiement du client (bouton de simulation) |
| Les demandes de paiement avec l'API de Jèko (possible) | La vérification d'identité (statique) |

**Visuel** : deux colonnes, vert à gauche, gris à droite. Aucune honte à montrer la colonne de droite : c'est notre crédibilité.

**À dire** (0:35)
> « Soyons clairs sur ce qui est réel. La voix est réelle : c'est l'API d'AethexAI. Argus est réel : il tourne chez nous avec son moteur, et
> nous avons posé deux règles pour la démonstration. La compréhension du français et le mot secret sont réels. Nous avons aussi créé de
> vraies demandes de paiement avec l'API de Jèko.
> Sont simulés : les transferts, qui n'envoient aucun argent, parce que Jèko n'a pas de mode test. La commerçante et son historique. Le
> paiement du client. Et la vérification d'identité, que nous avons faite statique, faute de temps. »

---

## 8. Démonstration en direct

**À l'écran**
- **Démonstration**
- *(en cas de problème : la vidéo de secours, ou revenir à la diapositive 5)*

**Visuel** : une diapositive presque vide, pour passer en plein écran sur les deux écrans : le téléphone de la maman (page `/`) et le grand écran de l'analyste (`/analyste`).

**À dire** : (3:00 au total) suivre le tableau. L'opérateur dit les phrases de la maman à voix haute avec un micro-casque. Le présentateur commente.

| Temps | Scène | Awa dit | L'assistant répond | Le présentateur dit |
| --- | --- | --- | --- | --- |
| 0:00 | 1. Encaisser | « Encaisse cinq mille francs par Wave. » puis « Oui. » | « Tu veux encaisser 5 000 francs par Wave. Tu confirmes ? » puis « C'est lancé. Le client peut scanner et payer. » | « Le matin, elle encaisse en parlant. Le client scanne le QR de la boutique. » *(clic sur « Simuler : le client a payé »)* « Paiement reçu. » |
| 0:45 | 2. Le doute | « Envoie cent cinquante mille francs à (prénom neuf). » | « 150 000 francs pour (prénom). C'est beaucoup plus que d'habitude, et c'est un nouveau contact. Je l'envoie ? » | « Le soir, on la force. Argus voit que c'est inhabituel, et l'assistant le dit à voix haute. » |
| 1:15 | 3. Le mot secret | « Oui, c'est bon, » + une phrase avec son mot secret | « C'est envoyé. 150 000 francs à (prénom). » | « Regardez son téléphone : c'est un succès, comme d'habitude. L'agresseur ne voit rien. » *(montrer le grand écran)* « Mais voici l'écran de Karim : Contrainte signalée. L'argent n'est pas parti. » |
| 2:00 | 4. Le blocage | « Envoie deux cent cinquante mille francs à (prénom neuf). » | « Cette opération de 250 000 francs est en attente de vérification. Tu peux la débloquer dans ton historique. » | « Si l'agresseur insiste, Argus bloque. Elle ne perd rien : elle débloquera en prouvant qui elle est. » |
| 2:25 | 5. Le support | « J'ai atteint la limite de 200 000, comment augmenter mon plafond ? » | La réponse du support, avec sa source | « Et la même voix répond aux questions, en citant sa source. » |

*Facultatif : après la scène 4, passer sur la console web d'Argus (`npm run argus:console`, http://localhost:5050, onglet déjà ouvert et connecté) :
le tableau de bord montre les opérations que nous venons de faire, avec leur verdict. Ne pas ouvrir les pages « Règles » (erreur) ni « Codes de contrainte » (vide) : voir le README.*

*Facultatif, si le temps le permet : à la scène 4, « Débloquer » dans l'historique, la date de naissance et les 4 chiffres affichés sous le formulaire en démonstration, puis « oui » à la relecture.*

**Notes pour l'opérateur**
- Le prénom des scènes 2 à 4 doit être **neuf** pour Argus (le panneau `/?demo=1` en propose).
- Si la voix échoue, utiliser les boutons du panneau `/?demo=1` et dire la phrase du plan B de `PITCH.md`.
- Dire le mot secret à voix haute devant le jury fait partie de la scène : après la présentation, le **changer**.

---

## 9. Ce que la construction nous a appris

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

## 10. Limites et suite

**À l'écran**

| Nos limites | La suite |
| --- | --- |
| Le mot secret protège contre la contrainte, pas contre toute fraude | Le brancher sur le bouton micro de Jèko Business |
| La voix dépend du bruit | Valider avec Jèko : retenir ou différer sous contrainte ? Le plafond de 200 000, par opération ou cumulé ? |
| Français seulement | Un vrai KYC à la place de la vérification statique |
| Prototype : pas de compte, pas de transfert réel | Les langues locales avec AethexAI |

**Visuel** : deux colonnes, orange pour les limites, violet pour la suite.

**À dire** (0:40)
> « Nos limites, dites franchement. Le mot secret protège contre la contrainte, pas contre toute fraude : un agresseur qui l'entend
> peut le comprendre. La voix dépend du bruit. Nous parlons français, pas encore les langues locales. Et ce n'est qu'un prototype :
> aucun compte, aucun vrai transfert.
> La suite : brancher cet assistant sur le bouton micro de Jèko Business, valider avec Jèko comment traiter une opération sous
> contrainte et comment fonctionne le plafond, remplacer notre vérification d'identité statique par un vrai KYC, et ajouter les langues locales. »

---

## 11. Clôture

**À l'écran**
> **Awa n'a pas eu besoin de savoir lire, ni de crier, pour se protéger.**

Merci. Les noms de l'équipe.

**Visuel** : fond violet, la phrase en blanc, très grande.

**À dire** (0:15)
> « Cette maman de Yamoussoukro n'avait pas besoin de savoir lire, ni de crier, pour se protéger. Avec Argus Voice, sa voix suffit.
> Merci. Nous sommes prêts pour vos questions. »

---

## À ne pas dire dans le diaporama

- « Argus est un dieu grec » : c'est un géant aux cent yeux.
- « Intégré à Jèko » : c'est un prototype indépendant qui utilise leur API.
- « De l'argent réel a été transféré » : jamais, les transferts sont simulés.
- « Ça marche dans le bruit » : dire « nous avons un mode de secours ».
- « Argus détecte tout seul les gros montants » : ce sont deux règles posées pour la démonstration.
- « Le mot secret est inviolable » ou « la vérification d'identité est réelle » : faux.
- Aucun chiffre de performance, de coût ou d'impact que nous n'avons pas mesuré.

Les réponses aux questions du jury sont dans [PITCH.md](PITCH.md#réponses-aux-questions-probables).
