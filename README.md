# Mbote SMS — dashboard Infobip

## Lancer
1. Installer Node.js 18 ou plus récent.
2. Copier `.env.example` en `.env`, puis y mettre votre URL de base, votre clé API et un mot de passe.
3. Dans ce dossier : `npm start`
4. Ouvrir http://localhost:3000 (identifiant `admin` + votre mot de passe).

## Ce que fait le dashboard
- **Tableau de bord** : solde, SMS envoyés, livrés, en attente, échecs, activité sur 14 jours.
- **Nouvelle campagne** : numéros collés, CSV (`numero;nom`) ou groupes ; personnalisation `{nom}` ;
  aperçu sur téléphone ; compteur de caractères et de SMS ; coût estimé ; envoi test avec suivi du statut ;
  programmation ; envoi par lots.
- **Campagnes** : filtres, taux de livraison, détail numéro par numéro, causes d'échec,
  renvoi aux numéros en échec, export CSV, annulation des envois programmés.
- **Journaux SMS** : recherche dans les journaux Infobip (48 h).
- **Comprendre les statuts** : explication de Livré / En attente / Échec et des codes Infobip.
- **Boîte de réception** : SMS reçus sur votre numéro entrant Infobip, réponse en un clic.
  Les réponses STOP / ARRET / DESABONNER ajoutent le numéro à la liste d'exclusion.
- **Liste d'exclusion** (page Contacts) : ces numéros sont retirés automatiquement de chaque campagne.
- **Vérification des numéros** (Number Lookup) : détecte les numéros inactifs et le vrai réseau
  avant l'envoi, et retire les invalides. Facturé par Infobip à chaque numéro vérifié.
- **Livraison par opérateur** : taux de livraison Vodacom / Orange / Airtel / Africell.
- **Modèles de messages** et **reprogrammation** des campagnes programmées.

## Permissions (scopes) utilisées par l'application
`sms:manage` (envoi, journaux, rapports, programmation), `sms:inbound-message:read` (SMS reçus),
`number-lookup:manage` (vérification), `account-management:manage` (solde).
Une clé limitée à ces 4 permissions suffit.

## SMS reçus en temps réel
Une fois en ligne avec `PUBLIC_URL`, indiquez dans le portail Infobip, sur votre numéro entrant,
l'adresse de transfert affichée dans la Boîte de réception (`/webhook/inbound?token=…`).
Sans cela, le dashboard récupère les SMS reçus toutes les 2 minutes.

## Comment le statut d'un SMS est connu
| Statut | Signification |
|---|---|
| Livré | L'opérateur a confirmé la réception sur le téléphone. |
| En attente | Envoyé, pas encore confirmé (téléphone éteint, ou accusé pas encore reçu). |
| Échec | Non livrable, rejeté (crédit, expéditeur, numéro) ou expiré (injoignable pendant la validité). |

Le dashboard combine trois sources :
1. **Webhook temps réel** : Infobip envoie chaque accusé de réception à `/webhook/dlr`.
   Actif uniquement si le dashboard est en ligne et que `PUBLIC_URL` est renseigné dans `.env`.
2. **Rapports de livraison** Infobip, interrogés toutes les minutes.
3. **Journaux** Infobip (état + prix), interrogés toutes les minutes, disponibles 48 h.

Sans `PUBLIC_URL`, les points 2 et 3 suffisent : les statuts arrivent avec environ une minute de décalage.

## Mettre en ligne (pour le temps réel)
Sur Render, Railway ou un VPS : déployez le dossier, définissez les variables
`INFOBIP_BASE_URL`, `INFOBIP_API_KEY`, `DASH_USER`, `DASH_PASS` et `PUBLIC_URL=https://votre-adresse`,
puis `npm start`. Les accusés reçus sont stockés dans `data/reports.json`
(sur Render, ajoutez un disque persistant pour le dossier `data`).

## Logo
Dossier `brand/` : `logo.svg` (fond clair), `logo-blanc.svg` (fond sombre), `logo-mark.svg` (icône),
et leurs versions PNG.

## Sécurité
- La clé API reste dans `.env` sur le serveur, jamais dans le navigateur.
- `.env` et `data/` sont exclus de Git par `.gitignore`.
- Le webhook est protégé par un jeton secret généré automatiquement (`data/webhook-token.txt`).
- Le mode « Direct » des Paramètres stocke la clé dans le navigateur : à n'utiliser qu'en local.
