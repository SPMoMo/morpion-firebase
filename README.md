# Morpion Multijoueur (Firebase CDN)

Ce projet fournit un jeu de **morpion** (tic-tac-toe) multijoueur prêt à déployer via **Firebase Console** en utilisant **uniquement la Firebase Web SDK via CDN**.

**Contenu du ZIP**
- `index.html` — interface et point d'entrée
- `styles.css` — styles responsive
- `app.js` — logique (connexion Firebase, matchmaking, jeu, IA Minimax, transactions)
- `README.md` — ce fichier
- `DEPLOY_IN_BROWSER.md` — guide pas-à-pas pour créer le projet Firebase et déployer via la console web

---

## Fonctionnalités
- Matchmaking rapide (Quick Match)
- Invitation par lien (shareable link `?gameId=...`)
- Parties 2 joueurs en temps réel (Firestore + onSnapshot)
- Mode solo contre IA avec Minimax (niveaux: easy, medium, hard)
- Parties chronométrées (1 min ou 2 min par joueur)
- Transactions Firestore pour garantir atomicité des coups
- Interface responsive (mobile & desktop)
- Tests QA (checklist fournie)

---

## Notes techniques rapides
- Le projet utilise la SDK **modulaire** Firebase via CDN (import ES modules).
- **Authentification anonyme** est utilisée pour identifier les joueurs (activation requise depuis la console Firebase).
- Les règles Firestore proposées sont fournies dans `DEPLOY_IN_BROWSER.md`.
- Les chronomètres fonctionnent en partie en client-side (approximations). Pour éviter la triche côté client, il faudrait ajouter une logique côté serveur (Cloud Functions) — voir la doc pour recommandations.

---

## Checklist QA (tests manuels recommandés)
1. **Connexion**
   - Lancer la page; vérifier qu'on est connecté anonymement (status indique "Connecté").
2. **Création d'une partie & invitation**
   - Créer une invitation; copier le lien; l'ouvrir dans un autre navigateur/onglet (utilisateur différent) et rejoindre.
3. **Matchmaking**
   - Depuis deux navigateurs distincts, faire "Quick Match" et vérifier que la partie se crée et passe à `playing`.
4. **Cohérence des coups**
   - Tester coups simultanés: tenter de jouer la même case très rapidement depuis deux clients. Un client doit échouer et l'autre réussir (transaction).
5. **Fin de partie**
   - Vérifier victoire X/O et match nul.
6. **Mode IA**
   - Choisir mode IA et vérifier niveaux `easy` (aléatoire), `medium` (mini-max depth limité), `hard` (minimax).
7. **Chrono**
   - Lancer une partie chronométrée (1min) et vérifier que lorsque le temps d'un joueur arrive à zéro, l'autre gagne.
8. **Responsive**
   - Ouvrir sur mobile / redimensionner fenêtre.
9. **Sécurité**
   - Tester l'accès non autorisé si possible (voir règles Firestore).
10. **Règles & déploiement**
    - Suivre `DEPLOY_IN_BROWSER.md` pour configurer Firebase. Tester l'application en production (hosting).

---

## Limitations connues
- Les chronomètres sont gérés côté client (calculs basés sur `Date.now()`), cela peut être manipulé. Pour un produit sérieux, utilisez Cloud Functions ou Realtime Database avec `serverTimeOffset` pour garantir timestamps serveurs.
- Le projet est un modèle pédagogique, à adapter pour production (rate-limiting, résilience, désactivation d'IP, etc).

Bonne utilisation — voir `DEPLOY_IN_BROWSER.md` pour déployer en quelques minutes.
