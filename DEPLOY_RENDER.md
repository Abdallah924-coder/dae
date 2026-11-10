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

`PUBLIC_APP_URL` doit valoir `https://dae-1lpj.onrender.com` (sans barre oblique finale). `ADMIN_EMAIL` reçoit les messages du formulaire de contact et une notification à chaque nouvelle demande d’achat ou de vente.

### Configurer les e-mails d’authentification

1. Dans Brevo, créez un expéditeur sous **Settings → Senders, Domains, IPs → Senders** et terminez sa vérification. Dans **Settings → SMTP & API → API Keys & MCP**, générez une clé API dédiée à DAE. Renseignez cette clé dans Render comme `BREVO_API_KEY`, l’adresse vérifiée comme `BREVO_SENDER_EMAIL`, et `DAE Crypto` comme `BREVO_SENDER_NAME`. Pour la production, authentifiez aussi votre domaine d’envoi avec les enregistrements DNS recommandés par Brevo. [Créer un expéditeur](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email) · [Créer une clé API](https://help.brevo.com/hc/en-us/articles/40159485019794-Create-and-manage-your-API-keys).
2. Dans Render, configurez `CUSTOMER_AUTH_SECRET` avec une valeur aléatoire d’au moins 32 caractères. Configurez `CUSTOMER_LEGAL_REVIEWED=true`, les versions `CUSTOMER_TERMS_VERSION` et `CUSTOMER_PRIVACY_VERSION`, puis les URL HTTPS publiques des conditions et de la politique de confidentialité déjà publiées : `CUSTOMER_TERMS_URL` et `CUSTOMER_PRIVACY_URL`.
3. Enregistrez les variables avec **Save, rebuild, and deploy**. Render ne connaît pas les valeurs de `sync: false` ajoutées ou modifiées dans un Blueprint existant : saisissez ces secrets depuis le tableau de bord. Le site ne se sert des nouvelles valeurs qu’après redéploiement. [Variables d’environnement Render](https://render.com/docs/configure-environment-variables).

Les codes d’inscription, de connexion et de récupération sont envoyés uniquement par e-mail. Infobip, s’il est configuré, ne sert pas aux codes d’authentification. L’inscription sera disponible quand l’API affichera `accounts.registration: true` dans `/api/account/features` et que l’administration indiquera l’e-mail et les documents publiés comme configurés. Faites un essai avec une adresse e-mail que vous contrôlez et vérifiez le statut d’envoi dans Brevo. Ne partagez jamais les clés API dans le dépôt ou dans un message.

### Notifications SMS des commandes (facultatif)

Infobip reste facultatif et sert uniquement aux notifications de suivi des commandes; il n’envoie aucun code de connexion, d’inscription ou de récupération. Si vous souhaitez garder ces notifications, configurez `INFOBIP_API_KEY`, `INFOBIP_BASE_URL` et `INFOBIP_SENDER` dans Render. La Base URL et l’expéditeur doivent correspondre à votre compte Infobip. Sinon, laissez ces paramètres non configurés; l’authentification par e-mail continue de fonctionner.

### Débloquer l’historique de marché CoinGecko

Les réponses HTTP 429 indiquent que la limite de requêtes publiques CoinGecko est atteinte. Créez une clé API Demo dans le tableau de bord CoinGecko, puis ajoutez-la dans Render comme variable secrète `COINGECKO_API_KEY` (ne la mettez ni dans le code ni dans le frontend). Enregistrez avec **Save, rebuild, and deploy**. Le serveur l’utilisera pour ses requêtes de prix et d’historique; le cache limite aussi les requêtes répétées. Après redéploiement, rechargez la page et vérifiez que le graphique affiche ses observations horaires. La clé augmente les quotas mais ne garantit pas une disponibilité continue de CoinGecko.

Les commandes et leurs événements d’audit exigent une base MongoDB compatible avec les transactions multi-documents. Planifiez `npm run expire` à intervalles réguliers depuis un ordonnanceur pour passer les demandes échues en statut expiré.

## URLs du site

Les pages utilisent des chemins sans suffixe `.html` : `/`, `/acheter`, `/vendre`, `/attente`, `/suivi`, `/contact` et `/admin`. Les anciennes URLs en `.html` redirigent vers ces chemins.

Depuis l’administration, les numéros Mobile Money MTN/Airtel peuvent être enregistrés avec le nom du bénéficiaire. Pour une vente, le client renseigne également le nom associé à son numéro Mobile Money.

L’administration `/admin` propose aussi un tableau des achats et ventes, ainsi qu’un interrupteur de maintenance avec un message personnalisable. Les visiteurs voient la page de maintenance tandis que l’administration reste accessible.

Les secrets sont saisis dans Render et ne doivent pas être copiés dans `render.yaml`, un dépôt Git ou un ticket. Le fichier `.env` local est exclu du dépôt par `.gitignore`.

Le plan `free` peut mettre le service en veille après une période d’inactivité; le premier accès suivant peut alors être lent. Sélectionnez un plan payant dans Render si le service doit rester disponible sans mise en veille.
