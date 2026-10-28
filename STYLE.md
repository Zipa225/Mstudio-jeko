# Charte visuelle : un écran qui a sa place dans l'app Jèko

Complément de `CLAUDE.md`. Notre écran représente **une fonctionnalité de Jèko** (la commande vocale protégée par Argus). Il doit donc avoir l'air d'appartenir à l'app Jèko Business, pas d'être un produit à côté.

Source de cette charte : **une seule capture d'écran** de l'accueil de l'app Jèko (iPhone), analysée le 28 octobre 2026. Les couleurs ont été mesurées sur l'image. Tout ce qui n'est pas visible sur la capture est marqué **[Proposition]** ou **[À confirmer]**. Elle sera à affiner avec les autres captures (voir section 9).

Une décision à connaître : le jaune de l'écran marchand du prototype v1 vient de moi, **pas de Jèko**. On le remplace par l'identité ci-dessous.

---

## 1. Ce que montre la capture

- En-tête : logo carré violet aux coins arrondis, mot « Jèko » en violet très foncé, icône wifi verte à droite.
- Un auvent rayé bleu et blanc avec le nom du magasin en dessous (ici « argus »).
- Le solde en très grand (« 0 F »), avec une icône œil pour le masquer.
- Une carte blanche arrondie avec le code QR du marchand.
- Une vague décorative bleu clair qui sépare le haut du reste de l'écran.
- Une carte blanche à trois actions : **Encaisser**, **Lien de paiement**, **Transférer**. Chaque action a une petite illustration colorée dans un cercle gris clair, et son nom dessous.
- Une carte d'alerte orange clair : icône d'avertissement, titre « Activez votre compte », une phrase, un gros bouton violet plein avec une flèche.
- Une barre d'onglets en bas : Accueil, Transactions, un **bouton rond violet central** avec une flèche vers le bas, Support, Paramètres.

L'ambiance : propre, très aérée, fond gris clair, cartes blanches, un seul violet fort pour tout ce qui est important, quelques touches de couleur dans les illustrations.

---

## 2. Palette

Valeurs mesurées sur la capture, arrondies. Les contrastes sont calculés.

### Couleurs de marque (mesurées)

| Rôle | Hex | Où on la voit |
| --- | --- | --- |
| Violet Jèko (principal) | `#3a0ca2` | Bouton « Finir mon inscription », bouton rond central, fond du logo |
| Violet très foncé | `#240465` | Mot « Jèko » dans l'en-tête |
| Violet onglet actif | `#130449` | Texte de l'onglet Accueil (icône un peu plus claire, `#4037a0`) |
| Fond d'écran | `#f3f4f6` | Fond général gris très clair |
| Carte | `#ffffff` | Cartes blanches (actions, QR) |
| Orange alerte (fond de carte) | `#fed99d` | Carte « Activez votre compte » |
| Texte sur orange | `#3b1e00` | Texte brun foncé et icône d'avertissement |
| Texte principal | `#000000` | Solde, titres, libellés des actions |
| Texte secondaire et onglets inactifs | `#6a6a6a` | « Transactions », « Support » |
| Bordure très claire | `#f5f3f9` | Contour de la carte QR |

### Accents des illustrations (mesurés, usage décoratif)

| Rôle | Hex | Où |
| --- | --- | --- |
| Bleu auvent | `#152bcb` | Rayures de l'auvent |
| Bleu clair | `#5fa9f3` | Icône « Lien de paiement » |
| Fond du cercle clair | `#e3ecf8` | Cercle de l'icône lien |
| Vague décorative | `#deeef5` | Vague entre le haut et le contenu |
| Vert connexion | `#04af60` | Icône wifi (réseau connecté) |

### Couleurs que la capture ne montre pas [Proposition]

| Rôle | Hex | Pourquoi |
| --- | --- | --- |
| Succès (fond de bouton « Oui ») | `#0b7a3e` | Le vert wifi `#04af60` est trop clair pour du texte blanc. Celui-ci passe. |
| Danger (« Non », erreur) | `#d92d20` | Aucun rouge visible sur la capture. À remplacer dès qu'on voit leur rouge. |
| Alerte critique (bannière analyste) | `#e5484d` | Le seul rouge très visible de l'écran analyste. |
| Fond sombre de l'écran analyste | `#14053f` | Dérivé du violet de marque pour rester dans la famille. |

### Contrastes à respecter

| Texte sur fond | Ratio | Verdict |
| --- | --- | --- |
| Blanc sur violet `#3a0ca2` | 12,0 | Très bon |
| Noir sur gris `#f3f4f6` | 19,1 | Très bon |
| Gris `#6a6a6a` sur `#f3f4f6` | 4,9 | Acceptable pour du texte normal |
| Noir sur orange `#fed99d` | 15,6 | Très bon |
| Blanc sur vert `#0b7a3e` | 5,4 | Bon |
| Blanc sur rouge `#d92d20` | 4,8 | Acceptable |
| Blanc sur vert wifi `#04af60` | 2,9 | **Insuffisant : ne pas mettre de texte blanc dessus** |

Règle : le violet porte tout ce qui est important (actions principales). Le rouge n'apparaît que pour un danger réel. On n'ajoute pas d'autres couleurs.

---

## 3. Variables CSS à coller dans `globals.css`

```css
:root {
  /* Marque Jèko (mesuré) */
  --jeko-violet: #3a0ca2;
  --jeko-violet-profond: #240465;
  --jeko-violet-actif: #130449;
  --fond: #f3f4f6;
  --carte: #ffffff;
  --alerte-fond: #fed99d;
  --alerte-texte: #3b1e00;
  --texte: #000000;
  --texte-doux: #6a6a6a;
  --bordure-claire: #f5f3f9;

  /* Accents d'illustration (mesuré) */
  --bleu-auvent: #152bcb;
  --bleu-clair: #5fa9f3;
  --bleu-pale: #e3ecf8;
  --vague: #deeef5;
  --connecte: #04af60;

  /* Proposition, à confirmer avec leurs autres écrans */
  --succes: #0b7a3e;
  --danger: #d92d20;
  --critique: #e5484d;
  --nuit: #14053f;

  /* Forme (estimée sur la capture) */
  --rayon-carte: 24px;
  --rayon-bouton: 16px;
  --rayon-rond: 999px;

  /* Texte */
  --police: "Poppins", system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

---

## 4. Typographie

- La capture montre une **sans-serif géométrique aux formes rondes**, avec des titres en semi-gras (« Activez votre compte », « Jèko ») et un solde très grand et espacé. Elle ressemble à **Poppins**. **[À confirmer]** : je ne peux pas identifier la police exacte à partir d'une image.
- Provisoire : Poppins (Google Fonts), avec repli sur la police système.
- Si Jèko nous donne leur police, on la remplace partout via la variable `--police`.

| Usage | Taille indicative | Graisse |
| --- | --- | --- |
| Solde ou grand chiffre | 48 à 56 px | Semi-gras |
| Titre de carte | 22 à 24 px | Semi-gras |
| Texte courant | 16 à 18 px | Normal |
| Libellé d'action, onglet | 13 à 14 px | Normal |

Pour notre écran vocal, on augmente les tailles : la réponse de l'agent s'affiche en **très gros** (32 px ou plus), car beaucoup de marchands lisent peu.

---

## 5. Formes et composants

Les rayons et espacements sont estimés sur la capture [À confirmer].

### Carte
Fond blanc, coins très arrondis (environ 24 px), pas d'ombre marquée, posée sur le fond gris. Marge latérale d'environ 16 à 20 px.

### Bouton principal
Pleine largeur dans sa carte, fond violet `#3a0ca2`, texte blanc semi-gras, flèche → à droite, coins arrondis (environ 16 px), hauteur généreuse (au moins 56 px).

### Carte d'alerte
Fond orange `#fed99d`, icône triangle d'avertissement brune, titre noir semi-gras, phrase d'explication brune, bouton principal violet en dessous.

### Barre d'onglets
Cinq emplacements : Accueil, Transactions, **bouton rond central** violet (flèche blanche vers le bas), Support, Paramètres. Onglet actif en violet foncé, inactifs en gris. Icône au-dessus du libellé.

### Icônes et illustrations
Petites illustrations colorées de style plat, dans un cercle gris très clair, avec le libellé dessous. Les logos et illustrations sont ceux de Jèko : **on ne les redessine pas**. On demande les fichiers officiels à Jèko (via le groupe WhatsApp) ou on utilise des icônes simples en attendant.

### Auvent
Rayures bleu `#152bcb` et blanc au-dessus du nom du magasin, sur l'écran d'accueil. À réutiliser comme élément de décor sur notre écran (une bande étroite en haut), sans copier leur dessin exact.

---

## 6. Notre écran marchand (voix) [Proposition]

L'écran vocal est **un écran de plus de l'app Jèko**. Il reprend l'ossature de l'accueil.

1. **En-tête identique** : logo Jèko en haut à gauche, icône réseau à droite. Une petite mention « Prototype hackathon » discrète, pour ne pas laisser croire que c'est l'app officielle.
2. **Fond** `--fond`, contenu dans des cartes blanches.
3. **Carte de la réponse de l'agent** : la phrase en très gros caractères, noir sur blanc. Le montant en chiffres, très grand, comme le solde « 0 F » de l'accueil.
4. **Bouton micro** : un grand rond violet `--jeko-violet`, de la même famille que le bouton rond central de leur barre d'onglets. Icône micro blanche.
5. **Les états du micro** (par la couleur et l'animation, pas par du texte) :

| État | Apparence |
| --- | --- |
| Au repos | Violet plein, icône micro |
| Écoute | Violet plein avec halo qui pulse, plus grand |
| Réflexion | Violet avec points animés |
| L'agent parle | Violet avec ondes autour |

6. **Confirmation** : deux gros boutons côte à côte. **Oui** en vert `--succes`, **Non** en rouge `--danger`, avec pictogrammes (coche, croix) pour ceux qui ne lisent pas. Texte blanc, 28 px ou plus.
7. **Succès** : grande coche dans un rond vert, « C'est envoyé » en gros. C'est aussi l'écran **identique** affiché sous contrainte : il ne doit rien laisser transparaître.
8. **Barre d'onglets du bas** de l'app Jèko gardée telle quelle, avec le bouton micro à la place ou à côté du bouton rond central. **[À confirmer]** avec la capture de l'écran Encaisser.
9. **Alerte orange** : utilisée pour la question de vérification (« C'est un nouveau numéro, c'est bien ça ? »), avec le même style que la carte « Activez votre compte ». L'agent la dit aussi à voix haute.

Le marchand ne voit **jamais** de rouge d'alerte critique : l'écran de contrainte est identique à un succès.

---

## 7. Écran analyste [Proposition]

Écran interne projeté sur le grand écran. Il est distinct de l'app marchand mais garde la famille de couleurs.

- Fond `--nuit` (`#14053f`), cartes un cran plus claires, texte blanc.
- Violet `--jeko-violet` pour les éléments d'interface et les compteurs.
- Orange `--alerte-fond` pour les alertes « attention » (vérification, rappel à faire).
- **Rouge `--critique` réservé à une seule chose : la bannière « Contrainte signalée »**. Elle doit être le seul rouge de l'écran, pour que le moment fort soit visible de loin.
- Tableau des opérations avec des pastilles d'état : exécutée (vert), annulée (gris), retenue (rouge), bloquée (orange).

---

## 8. Règles de cohérence

1. Une seule couleur forte : le violet. Pas de jaune, pas de dégradé.
2. Fond gris `#f3f4f6` et cartes blanches pour tout l'écran marchand.
3. Coins très arrondis partout (cartes, boutons).
4. Peu de texte, gros caractères, une idée par écran.
5. Pictogrammes avec chaque action importante (oui, non, envoyé, micro).
6. Pas d'ombre lourde ni de décor chargé : l'app Jèko est aérée.
7. L'état est dit par la **couleur et la voix**, jamais par un texte seul.
8. Respecter les contrastes du tableau de la section 2.
9. `prefers-reduced-motion` : couper les animations si l'utilisateur l'a demandé, sauf le halo du micro réduit.

---

## 9. Captures à faire pour affiner cette charte

Chaque capture sert à confirmer un point précis. Les faire sur le téléphone, en plein écran.

| Capture | Ce qu'on en tire |
| --- | --- |
| Écran **Encaisser** (saisie du montant) | Boutons, champs, clavier, couleur de succès et d'erreur |
| Écran **Transférer** | Formulaire, choix du bénéficiaire, écran de confirmation |
| **Confirmation de paiement** reçue ou envoyée | L'écran de succès : couleur, icône, texte |
| Un **message d'erreur** (n'importe lequel) | Leur rouge et leur style d'erreur |
| Écran **Support** | Style des conversations, bulles, boutons |
| Écran **Transactions** | Liste, pastilles d'état, séparateurs |
| **Paramètres** | Liste de réglages, interrupteurs |
| La barre d'onglets **en gros plan** | Icônes, taille du bouton central |
| Une capture en **mode sombre**, si l'app en a un | Palette sombre |

Pour chaque capture, relever : couleurs de fond et de texte, rayons des coins, taille des boutons, police, icônes. Envoie-les-moi et je mets cette charte à jour (section 2 d'abord).

### À confirmer avec ces captures
- [ ] La police exacte.
- [ ] Les rayons des coins et les espacements.
- [ ] Leur couleur de succès et leur couleur d'erreur.
- [ ] La place du bouton micro dans la barre d'onglets.
- [ ] Le style des écrans de confirmation.
- [ ] Les fichiers officiels du logo et des icônes (à demander à Jèko).
