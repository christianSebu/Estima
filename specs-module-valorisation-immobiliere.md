# Spec technique — Estima (Module de Valorisation Immobilière)

## 0. Contexte et objectif

Service indépendant qui estime la valeur vénale d'un bien immobilier à partir de son adresse et de ses caractéristiques. Consommé en HTTP par **Locatis** (gestion locative) et **Patrimo** (agrégateur patrimonial), et réutilisable pour d'autres projets futurs (acquisition TPE, etc.).

**Pourquoi un microservice et pas un package partagé :**
- Patrimo a besoin d'**historiser** les valorisations dans le temps (suivi patrimonial) → le service doit avoir son propre état (base de données), pas juste une fonction pure.
- L'ingestion DVF est lourde (fichiers volumineux, géocodage) → à faire une seule fois côté service, pas dupliquée dans chaque appli consommatrice.
- Les deux applis clientes restent découplées de la logique de valorisation ; on peut la faire évoluer sans redéployer Locatis ou Patrimo.

## 1. Architecture générale

```
┌─────────────┐     ┌─────────────┐
│   Locatis   │     │   Patrimo   │
└──────┬──────┘     └──────┬──────┘
       │  HTTP (token API)  │
       └─────────┬──────────┘
                  ▼
       ┌───────────────────────┐
       │        Estima         │
       │  (Next.js API routes) │
       ├───────────────────────┤
       │  Postgres (Neon)      │
       │  - cache DVF          │
       │  - historique des     │
       │    valorisations      │
       └───────────────────────┘
              │           │
              ▼           ▼
      ┌───────────┐  ┌──────────┐
      │  API BAN  │  │ DVF/DGFiP│
      │(géocodage)│  │(data.gouv)│
      └───────────┘  └──────────┘
```

**Stack** (cohérente avec Locatis/Superhote) : Next.js + TypeScript, PostgreSQL via Neon, Prisma ORM, déploiement Vercel. Authentification inter-services par simple token API en header (pas d'OAuth à ce stade — usage interne, faible volume).

## 2. Sources de données

| Source | Usage | Fréquence de mise à jour |
|---|---|---|
| **API Adresse (BAN)** — adresse.data.gouv.fr | Géocodage de l'adresse en entrée (lat/lon + code INSEE + section cadastrale) | Appel à la volée, gratuit, pas de clé requise |
| **DVF** (Demandes de Valeurs Foncières) — data.gouv.fr / cadastre.data.gouv.fr | Transactions immobilières réelles (prix, surface, type, date) pour construire les comparables | Publié 2x/an par la DGFiP ; à ingérer et mettre en cache localement |
| **DPE ADEME** (base des diagnostics de performance énergétique) | Facteur d'ajustement de la valorisation (classe énergétique) | Mise à jour continue, API publique gratuite |

DVF ne couvre pas l'Alsace-Moselle (cadastre différent) — à signaler en V1 comme limite connue si pertinent pour ton patrimoine.

## 3. Modèle de données (Prisma)

```prisma
model Property {
  id            String   @id @default(cuid())
  address       String
  postalCode    String
  city          String
  inseeCode     String
  latitude      Float
  longitude     Float
  propertyType  PropertyType   // APPARTEMENT, MAISON
  surface       Float          // m² habitable
  rooms         Int
  floor         Int?
  hasElevator   Boolean?
  hasOutdoor    Boolean?       // balcon/terrasse/jardin
  hasParking    Boolean?
  condition     PropertyCondition? // NEUF, BON_ETAT, A_RENOVER
  dpeClass      String?        // A-G
  sourceApp     String         // "locatis" | "patrimo"
  externalRef   String?        // id du bien dans l'appli source
  createdAt     DateTime @default(now())
  valuations    Valuation[]
}

model Valuation {
  id              String   @id @default(cuid())
  propertyId      String
  property        Property @relation(fields: [propertyId], references: [id])
  estimatedValue  Float
  pricePerSqm     Float
  confidenceScore Float    // 0-1, basé sur nb de comparables et dispersion
  comparablesUsed Int
  methodology     String   // version de l'algo, pour traçabilité
  computedAt      DateTime @default(now())
}

model DvfTransactionCache {
  id            String   @id @default(cuid())
  inseeCode     String
  section       String?
  propertyType  PropertyType
  surface       Float
  price         Float
  pricePerSqm   Float
  transactionDate DateTime
  latitude      Float
  longitude     Float

  @@index([inseeCode, propertyType])
}

enum PropertyType {
  APPARTEMENT
  MAISON
}

enum PropertyCondition {
  NEUF
  BON_ETAT
  A_RENOVER
}
```

## 4. Algorithme de valorisation (V1)

1. **Géocodage** — Appel API BAN avec l'adresse texte → lat/lon + code INSEE + code section cadastrale.
2. **Sélection des comparables** — Requête sur `DvfTransactionCache` filtrée par :
   - même code INSEE (élargir à la commune limitrophe si < 5 comparables)
   - même `propertyType`
   - surface dans une fourchette de ±20 % de la surface du bien
   - transaction dans les 24 derniers mois (pondération dégressive au-delà de 12 mois)
3. **Calcul du prix/m² de référence** — Médiane pondérée des comparables, poids = f(proximité géographique, récence de la transaction).
4. **Ajustements** — Coefficients multiplicatifs appliqués au prix/m² de référence :

   | Facteur | Ajustement |
   |---|---|
   | Étage élevé sans ascenseur | −3 à −5 % |
   | Étage élevé avec ascenseur | +2 % |
   | Extérieur (balcon/terrasse/jardin) | +3 à +8 % selon surface extérieure |
   | Parking/box | +2 à +5 % |
   | État à rénover | −10 à −15 % |
   | DPE F/G | −5 à −8 % |
   | DPE A/B | +3 à +5 % |

   *(coefficients à calibrer avec quelques cas réels de ton portefeuille en phase de validation.)*
5. **Score de confiance** — Fonction du nombre de comparables trouvés et de leur dispersion (écart-type des prix/m²). Un score bas doit être affiché clairement côté appli consommatrice (ex: "estimation peu fiable, données insuffisantes").
6. **Résultat** — `estimatedValue = pricePerSqm_ajusté × surface`, stocké en `Valuation` avec horodatage.

## 5. API (endpoints V1)

```
POST /api/valuations
  body: { address, propertyType, surface, rooms, floor?, hasElevator?,
          hasOutdoor?, hasParking?, condition?, dpeClass?, sourceApp, externalRef? }
  → crée/retrouve le Property, calcule et retourne une Valuation

GET /api/valuations/:propertyId
  → historique des valorisations pour un bien

GET /api/properties?sourceApp=locatis&externalRef=xxx
  → retrouver un bien déjà enregistré depuis l'appli appelante

POST /api/admin/dvf-import
  → déclenche l'ingestion/rafraîchissement du cache DVF pour un département donné
```

Toutes les routes protégées par header `Authorization: Bearer <API_TOKEN>`.

## 6. Pipeline d'ingestion DVF

- Script batch (pas temps réel) : télécharge les fichiers DVF (CSV) par département depuis data.gouv.fr, filtre sur ventes de logements (exclut locaux commerciaux, terrains), géocode si nécessaire, insère dans `DvfTransactionCache`.
- Déclenché manuellement au départ (`POST /api/admin/dvf-import`), à automatiser en V2 (cron Vercel, 2x/an au rythme de publication DVF).
- V1 : périmètre = les 8 départements d'Île-de-France dès le départ (75, 77, 78, 91, 92, 93, 94, 95).
  - Priorité d'ingestion sur **77 (Seine-et-Marne)** — Chelles (colocation) — et **94 (Val-de-Marne)** — Villiers-sur-Marne (LMNP courte durée), zone probable de la future RP — puisque ce sont les départements où se trouvent déjà des biens réels, utiles pour calibrer et valider l'algorithme (point 2 ci-dessous) avant d'ingérer le reste.
  - Les 6 autres départements sont ingérés dans la foulée avec le même pipeline, sans logique différente.

## 7. Roadmap

**V1 (MVP)**
- Géocodage BAN + algorithme de comparables DVF de base (sans DPE)
- Ingestion DVF manuelle, départements limités à ton patrimoine actuel
- 3 endpoints ci-dessus, auth par token simple
- Pas d'interface — consommé uniquement via API par Locatis/Patrimo

**V2**
- Ajustement DPE, automatisation de l'ingestion DVF (cron)
- Interface d'administration simple pour visualiser/recalibrer les coefficients d'ajustement
- Extension à d'autres départements à la demande
- Webhook ou notification quand une nouvelle valorisation diverge fortement de la précédente (utile pour Patrimo)

**V3 (optionnel)**
- Intégration Rwanda (structure de données différente, pas de DVF équivalent — approche à redéfinir)

## 8. Intégration Locatis / Patrimo

- **Locatis** : appelle `/api/valuations` à la création d'un bien et périodiquement (ex: 1x/an) pour suivre la valorisation locative dans le calculateur de rentabilité déjà en place.
- **Patrimo** : appelle `/api/valuations` pour chaque bien détenu, stocke les résultats dans son propre suivi patrimonial, consomme `/api/valuations/:propertyId` pour l'historique et les courbes de valorisation.
- Chaque appli passe son `sourceApp` + `externalRef` pour que le service de valorisation puisse retrouver le bien sans dupliquer sa propre logique d'identifiants.

**Fréquence de revalorisation (tranché) :**
- **Patrimo** : revalorisation automatique **1x/mois** pour chaque bien suivi, alignée sur le rythme observé chez MeilleursAgents. Le calcul lui-même est instantané (le cache DVF change moins souvent, 2x/an, mais le recalcul mensuel garde une courbe régulière et lisible dans l'historique de valorisation).
- **Locatis** : valorisation ponctuelle/manuelle suffisante, déclenchée à la création du bien et à la demande — usage différent (calcul de rentabilité), pas de suivi patrimonial continu à ce stade.
- En V2, ce déclenchement mensuel pour Patrimo pourra être automatisé côté Estima (cron) plutôt que côté appli cliente, si ça simplifie l'implémentation.

## 9. Points ouverts à valider avant développement

1. ~~Départements à couvrir en V1~~ — tranché : les 8 départements d'Île-de-France dès le départ, ingestion priorisée sur 77 et 94 (voir section 6)
2. Calibrage des coefficients d'ajustement — à tester sur 2-3 biens connus pour vérifier la cohérence du résultat
3. ~~Nom définitif du service~~ — tranché : **Estima**
