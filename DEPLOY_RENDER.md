# Déploiement sur Render

## Prérequis

- Le projet doit être poussé dans un dépôt GitHub, GitLab ou Bitbucket relié à Render.
- `MONGODB_URI` doit pointer vers une base MongoDB accessible depuis Render, par exemple MongoDB Atlas. `127.0.0.1` et `localhost` ne conviennent pas.
- Dans Atlas, autorisez les connexions réseau de Render et créez un utilisateur de base de données dédié.
- Configurez un expéditeur vérifié dans Brevo et récupérez une clé API.
- Les cours sont obtenus gratuitement et sans clé via l’API publique CoinPaprika, avec CoinGecko en source de secours.

## Déployer

1. Dans Render, choisissez **New > Blueprint** et connectez le dépôt du projet.
2. Render détectera `render.yaml` et préparera le service web `dae-crypto`.
3. Lors de la configuration, renseignez les variables marquées comme secrètes :
   - `MONGODB_URI` : URI de la base MongoDB de production.
   - `ADMIN_EMAIL` et `ADMIN_PASSWORD` : identifiants de connexion à l’administration.
   - `ADMIN_SESSION_SECRET` : chaîne aléatoire d’au moins 32 caractères.
   - `BREVO_API_KEY` : clé API de Brevo.
   - `BREVO_SENDER_EMAIL` : adresse d’expédition vérifiée dans Brevo.
4. Lancez le déploiement. Render exécute `npm ci`, puis `npm start`.
5. Vérifiez l’URL Render et `/healthz`. La réponse doit être HTTP 200 avec `{"status":"ok"}`; une base non connectée retourne HTTP 503.
6. Testez une connexion admin, une commande et l’envoi du formulaire de contact.

## URLs du site

Les pages utilisent des chemins sans suffixe `.html` : `/`, `/acheter`, `/vendre`, `/attente`, `/suivi`, `/contact` et `/admin`. Les anciennes URLs en `.html` redirigent vers ces chemins.

Depuis l’administration, les numéros Mobile Money MTN/Airtel peuvent être enregistrés avec le nom du bénéficiaire. Pour une vente, le client renseigne également le nom associé à son numéro Mobile Money.

Les secrets sont saisis dans Render et ne doivent pas être copiés dans `render.yaml`, un dépôt Git ou un ticket. Le fichier `.env` local est exclu du dépôt par `.gitignore`.

Le plan `free` peut mettre le service en veille après une période d’inactivité; le premier accès suivant peut alors être lent. Sélectionnez un plan payant dans Render si le service doit rester disponible sans mise en veille.
