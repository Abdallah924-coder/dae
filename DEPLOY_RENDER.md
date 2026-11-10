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
   - `ADMIN_EMAIL` et `ADMIN_PASSWORD` : première identité d’administration.
   - `ADMIN_SECOND_EMAIL` et `ADMIN_SECOND_PASSWORD` : deuxième identité indépendante, avec e-mail et mot de passe distincts; requis pour les propositions et approbations DAE Earn.
   - `DAE_EARN_TREASURY_ADDRESS` : adresse publique du wallet Earn DAE sur BNB Smart Chain, géré par l’entreprise. Ne renseignez ici aucune clé privée ni phrase de récupération.
   - `ADMIN_SESSION_SECRET` : chaîne aléatoire d’au moins 32 caractères.
   - `BREVO_API_KEY` : clé API de Brevo.
   - `BREVO_SENDER_EMAIL` : adresse d’expédition vérifiée dans Brevo.
4. Lancez le déploiement. Render exécute `npm ci`, puis `npm start`.
5. Vérifiez l’URL Render et `/healthz`. La réponse doit être HTTP 200 avec `{"status":"ok"}`; une base non connectée retourne HTTP 503.
6. Testez une connexion admin, une commande et l’envoi du formulaire de contact.

`PUBLIC_APP_URL` doit valoir `https://dae-1lpj.onrender.com` (sans barre oblique finale). `ADMIN_EMAIL` reçoit les messages du formulaire de contact et une notification à chaque nouvelle demande d’achat ou de vente. L’administration accepte les deux identités configurées. Pour DAE Earn, un changement proposé par une identité doit être approuvé par l’autre; des variables absentes, identiques ou mal configurées bloquent cette opération. Ne partagez pas les mots de passe entre administrateurs.

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

### DAE Earn (opérations manuelles avec preuves)

Les souscriptions restent fermées par défaut. Les paramètres d’ouverture se proposent dans Administration → DAE Earn puis nécessitent l’approbation du second administrateur. Après activation, le client utilise le bouton « Souscrire et verrouiller » : le ledger déplace atomiquement ses USDT disponibles vers le compartiment staké. Le placement reste en attente jusqu’à ce que DAE ait effectué l’allocation depuis son wallet d’entreprise.

DAE exécute les dépôts et retraits Venus/Aave hors de la plateforme. L’administration n’accepte ensuite que des reçus BSC confirmés correspondant à l’adresse de trésorerie et aux contrats configurés; un autre administrateur doit approuver avant toute activation, écriture de revenu ou libération du capital client. Les clés de la trésorerie ne sont jamais demandées ni stockées par le site.

Le compte `DAE_EARN_TREASURY_ADDRESS` doit commencer par être rapproché avec « Proposer le solde initial ». Les apports ultérieurs sont enregistrés avec leur hash de transaction. La page affiche le solde BEP-20 comparé au compte de cash Earn du ledger; tout écart doit être investigué avant une nouvelle allocation. Les revenus ne sont reconnus qu’après récupération confirmée vers la trésorerie. Le système impute d’abord les retraits au principal restant de chaque allocation; seul le surplus constaté est considéré comme rendement, puis réparti selon les pourcentages configurés (70 % récompenses, 20 % DAE, 10 % réserve par défaut).

Les récompenses quotidiennes sont calculées selon l’APY du produit divisé par 365, puis plafonnées au solde du pool réellement financé. Le job est déclenché par le serveur toutes les 15 minutes pour traiter la journée UTC terminée, rattraper les dates manquantes et redistribuer les demandes non financées; chaque journée et chaque crédit sont idempotents. Le job ne verse rien si `rewardsEnabled` est désactivé ou si le pool est vide. Un retrait demandé ne crédite pas immédiatement le solde : il attend la récupération et le rapprochement du principal, puis l’approbation croisée. La pénalité sur les récompenses déjà créditées est figée à la souscription; toute pénalité exige le solde disponible du client et ne peut pas réduire son capital.

Ces boutons et vérifications ne remplacent pas une validation juridique, une revue sécurité indépendante, un test de reprise, une vérification des contrats et de la liquidité par DAE, ni une réconciliation complète de tous les actifs DeFi. N’activez pas les produits pour des clients réels avant ces validations et un essai d’exploitation contrôlé.

## URLs du site

Les pages utilisent des chemins sans suffixe `.html` : `/`, `/acheter`, `/vendre`, `/attente`, `/suivi`, `/contact` et `/admin`. Les anciennes URLs en `.html` redirigent vers ces chemins.

Depuis l’administration, les numéros Mobile Money MTN/Airtel peuvent être enregistrés avec le nom du bénéficiaire. Pour une vente, le client renseigne également le nom associé à son numéro Mobile Money.

L’administration `/admin` propose aussi un tableau des achats et ventes, ainsi qu’un interrupteur de maintenance avec un message personnalisable. Les visiteurs voient la page de maintenance tandis que l’administration reste accessible.

Les secrets sont saisis dans Render et ne doivent pas être copiés dans `render.yaml`, un dépôt Git ou un ticket. Le fichier `.env` local est exclu du dépôt par `.gitignore`.

Le plan `free` peut mettre le service en veille après une période d’inactivité; le premier accès suivant peut alors être lent. Sélectionnez un plan payant dans Render si le service doit rester disponible sans mise en veille.
