# DAE Crypto

Plateforme d’achat et de vente de cryptomonnaies avec API Express, MongoDB et interface React.

## Développement

Utilisez Node.js 20 ou plus récent, puis installez les dépendances avec `npm ci`.

- `npm run dev` démarre l’API Express sur le port 3000 avec redémarrage automatique.
- `npm run dev:client` démarre Vite sur le port 5173. La configuration Vite relaie `/api` et `/images` vers Express.
- `npm run build` compile l’interface React dans `public/app`.
- `npm start` démarre l’API. Compilez d’abord l’interface si le dossier `public/app` n’existe pas.

L’API a besoin de `MONGODB_URI`. Les notifications e-mail, SMS et la connexion d’administration utilisent les variables documentées dans `.env.example`.

## Déploiement Render

Render installe les dépendances, compile React avec `npm run build`, puis démarre Express. Le serveur sert les routes `/`, `/acheter`, `/vendre`, `/suivi`, `/attente`, `/contact` et `/admin` depuis l’application React. Les endpoints métier restent sous `/api`.

Le taux par défaut est de **635 FCFA/USDT quand le client achète** et **580 FCFA/USDT quand il vend**. Les taux déjà enregistrés dans MongoDB restent prioritaires : pour une base existante, enregistrez ces deux montants dans Administration → Taux & limites afin de les appliquer aux commandes.
