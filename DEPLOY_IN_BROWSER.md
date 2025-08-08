# DEPLOY_IN_BROWSER.md — Déploiement via Firebase Console (GUIDE FR)

Ce guide explique **pas à pas** comment déployer l'application uniquement depuis la **console Firebase (web)**, sans installation locale.

> Pré-requis : un compte Google et accès à la console Firebase. Optionnel : Visual Studio Code pour éditer les fichiers localement.

---

## 1) Créer un projet Firebase
1. Aller sur https://console.firebase.google.com/ et cliquer sur **Ajouter un projet**.
2. Donner un nom (ex: `morpion-demo`) → Continuer → désactiver/activer Google Analytics selon votre préférence → Créer.

## 2) Ajouter une application Web
1. Dans la vue du projet, cliquer sur l'icône `</>` (Ajouter une application Web).
2. Donner un nom (ex: `morpion-web`) puis cliquer sur **Enregistrer**.
3. La console affichera un objet de configuration Firebase (`apiKey`, `authDomain`, `projectId`, etc). **Copier** cet objet.

> Remarque : Dans `app.js`, remplacez le bloc `firebaseConfig` par ces valeurs.

## 3) Activer l'authentification anonyme
1. Menu de gauche → **Authentication** → Onglet **Méthode de connexion**.
2. Activer **Connexion anonyme**.

## 4) Créer la base de données Firestore
1. Menu → **Firestore Database** → **Créer une base de données**.
2. Choisir **Mode de production** (ou test si vous préférez), emplacement → Créer.
3. Vous pouvez laisser la base vide — l'application créera les documents `games`.

## 5) Règles de sécurité Firestore (exemples)
Voici des règles d'exemple pour démarrer. Elles permettent aux utilisateurs anonymes de créer/jouer des parties et empêchent des modifications malicieuses basiques. Adaptez pour production.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Collection games: seulement les utilisateurs authentifiés peuvent créer/mettre à jour.
    match /games/{gameId} {
      allow create: if request.auth != null;
      allow read: if true; // lecture publique pour spectateurs
      allow update: if request.auth != null
        && (
          // mise à jour autorisée si l'utilisateur est joueur X ou O ou le créateur
          resource.data.players.X.uid == request.auth.uid
          || resource.data.players.O.uid == request.auth.uid
          || resource.data.creator.uid == request.auth.uid
        );
      allow delete: if request.auth != null && resource.data.creator.uid == request.auth.uid;
    }

    // Par défaut: interdire tout
    match /{document=**} { allow read: if false; allow write: if false; }
  }
}
```

> Ces règles sont un **exemple** minimaliste. Pour production, vous devez :
> - Valider le format des updates (ex: empêcher modification directement du champ 'winner' sans cohérence avec le board).
> - Ajouter validations sur `timers`, `moveCount`, `turn`, etc.
> - Considérer l'utilisation de Cloud Functions pour la logique critique (minimax côté serveur, vérification des coups, timestamps serveurs).

Vous pouvez tester ces règles avec l'outil "Rules simulator" dans la console Firestore.

## 6) Déploiement via Firebase Hosting (option console / GitHub)
Il y a deux façons sans installer `firebase-tools` localement :

### A) Déployer via GitHub (intégration depuis la console)
1. Créez un dépôt GitHub public (ex: `morpion-firebase-demo`) et poussez les fichiers `index.html`, `styles.css`, `app.js`, `README.md`, `DEPLOY_IN_BROWSER.md`.
2. Dans la console Firebase → **Hosting** → **Commencer** → Choisir **GitHub**.
3. Autoriser l'accès à votre compte GitHub et sélectionner le repo & branche.
4. Définir le dossier public à la racine (généralement `/`) et configurer la build comme "Aucun" si c'est un site statique.
5. Lier et déployer ; Firebase va automatiquement déployer via GitHub Actions. Vous obtiendrez une URL `https://<project>.web.app`.

### B) Déployer directement via l'interface "Hosting" (Uploader manuellement)
1. Firebase Hosting propose une option "Publier" → "Téléverser des fichiers" (UI de la console).
2. Uploadez `index.html`, `styles.css`, `app.js` et autres fichiers à la racine.
3. Déployer. (Note: L'UI est pratique pour un petit site statique).

> Important : si vous hébergez via GitHub, mettez le fichier `firebase.json` minimal si nécessaire :
> ```json
> {
>   "hosting": {
>     "public": ".",
>     "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
>   }
> }
> ```

## 7) Tester en production
- Ouvrez l'URL fournie par Firebase Hosting.
- Vérifiez que vous pouvez créer une partie, partager le lien `?gameId=...` et que d'autres clients y accèdent.

---

## 8) Recommandations de sécurité & production
- **Valider côté serveur** toute logique critique (Cloud Functions).
- **Limiter** la taille des requêtes et les opérations par seconde (rate limit).
- **Ne pas** faire confiance aux chronos côté client: pour parties compétitives, utilisez timestamps serveurs.
- **Monitoring**: activer alertes facturation (les lectures/écritures Firestore peuvent coûter).

---

## 9) Ressources utiles (docs officielles)
- Ajouter Firebase au Web (CDN / modules) — Documentation officielle: https://firebase.google.com/docs/web/setup
- Transactions Firestore: https://firebase.google.com/docs/firestore/manage-data/transactions
- Règles de sécurité Firestore: https://firebase.google.com/docs/firestore/security/get-started

Bon déploiement !