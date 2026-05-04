# DallAudit V3

Application PWA d'audit de dallage industriel — terrain, offline-first, rapports PDF.

## Stack

| Couche | Technologie |
|--------|------------|
| Frontend | React 18 + Vite + TypeScript |
| PWA | vite-plugin-pwa + Workbox |
| Offline DB | IndexedDB via Dexie |
| Backend | Fastify 4 + TypeScript |
| Base de données | PostgreSQL 16 |
| Rapports | PDFKit (server-side) |
| Auth | JWT (@fastify/jwt) |

## Démarrage rapide (dev)

### Prérequis
- Node 20+
- PostgreSQL 16 (ou Docker)

### 1. Base de données

```bash
# Avec Docker
docker run -d --name dallaudit-pg \
  -e POSTGRES_DB=dallaudit \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16-alpine

# Appliquer la migration
psql postgresql://postgres:postgres@localhost:5432/dallaudit \
  -f backend/migrations/001_init.sql
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
# → http://localhost:3001
# → GET /api/health doit répondre { ok: true }
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Compte par défaut

| Email | Mot de passe |
|-------|-------------|
| `admin@dallaudit.fr` | `Admin123!` |

> ⚠️ Changez ce mot de passe dès la première connexion.

---

## Architecture

```
dallaudit-v3/
├── backend/
│   ├── src/
│   │   ├── server.ts          # Fastify, plugins, routes
│   │   ├── db.ts              # Pool PostgreSQL
│   │   ├── routes/
│   │   │   ├── auth.ts        # POST /api/auth/login, GET /api/auth/me
│   │   │   ├── audits.ts      # CRUD /api/audits + upload plan
│   │   │   ├── observations.ts # CRUD /api/observations
│   │   │   ├── sync.ts        # GET /api/health, /api/sync/pull, POST /api/sync/mutations
│   │   │   ├── photos.ts      # POST/DELETE /api/photos/:id
│   │   │   └── reports.ts     # GET /api/reports/:auditId/pdf
│   │   └── services/
│   │       ├── photo-store.ts # Stockage disque, hash SHA256
│   │       └── report.ts      # Génération PDF (PDFKit)
│   └── migrations/
│       └── 001_init.sql       # Schéma complet + données démo
│
└── frontend/
    └── src/
        ├── sync/
        │   ├── db.ts          # IndexedDB (Dexie) — 4 stores
        │   ├── queue.ts       # SyncEngine — mutations + backoff
        │   ├── net.ts         # Triple détection réseau
        │   ├── api.ts         # Client HTTP typé
        │   └── photos.ts      # Compression + stockage Blob
        ├── lib/
        │   ├── useSync.ts     # Hooks React (useNetwork, useSync, useLiveQuery)
        │   └── AuthContext.tsx
        ├── pages/
        │   ├── LoginPage.tsx
        │   ├── DashboardPage.tsx  # Liste des audits + stats
        │   ├── AuditPage.tsx      # Tabs: Liste / Plan / Rapport
        │   ├── ObservationFormPage.tsx  # Form + photos + plan
        │   └── SyncPage.tsx       # Statut réseau + journal mutations
        └── components/
            └── Layout.tsx     # Topbar + BottomNav + ToastLayer
```

---

## Fonctionnalités V3

### Offline-first
- Toutes les observations sont créées/modifiées **dans IndexedDB en premier**
- Une file de mutations (IndexedDB) envoie les changements au serveur en arrière-plan
- Backoff exponentiel : 0s → 2s → 8s → 30s → 90s → 5min
- Détection réseau triple niveau : navigator.onLine + heartbeat + override manuel

### Synchronisation
- `POST /api/sync/mutations` — batch de mutations, résolution de conflits LWW (50ms)
- `GET /api/sync/pull?sinceMs=` — pull delta depuis un timestamp
- Idempotence via `clientMutationId` (UUID stable par mutation)
- Résolution de conflit exposée à l'UI : observation mise en `syncStatus: 'conflict'`

### Photos
- Compression client-side avant stockage : 1920px max, JPEG 0.82
- Thumbnail 240px pour l'affichage liste
- Upload multipart vers `/api/photos/:id`
- Stockage serveur dans `uploads/photos/YYYY-MM/`
- Affichage fullscreen au clic

### Plan de sol
- Upload d'image (JPEG/PNG/WebP) comme plan de sol d'un audit
- Placement de marqueurs par clic sur le plan
- Coordonnées normalisées [0,1] stockées sur l'observation

### Rapports PDF
- Générés server-side avec PDFKit
- Couverture : titre, site, KPIs, répartition par pathologie
- Tableau des observations avec photos embarquées
- Téléchargement direct depuis l'app

### PWA
- Installable iOS (Safari > Partager) / Android (Chrome) / Desktop
- Service Worker Workbox : NetworkFirst pour API, CacheFirst pour photos
- Toast de mise à jour disponible
- Mode démo : override manuel hors-ligne

---

## Pathologies supportées

| Code | Libellé |
|------|---------|
| FIS | Fissure |
| ECL | Éclat / Épaufrure |
| AFF | Affaissement |
| DEC | Décollement |
| TAS | Tassement différentiel |
| USU | Usure prématurée |
| HUM | Humidité / Remontée capillaire |
| FER | Ferraillage apparent |
| JOI | Joint dégradé |
| DAL | Dalle cassée |
| AUT | Autre |

---

## Déploiement Docker

```bash
# Tout démarrer
docker compose up -d

# Vérifier
curl http://localhost:3001/api/health
# → { "ok": true, "t": ..., "v": 3 }
```

---

## Variables d'environnement backend

| Variable | Défaut | Description |
|----------|--------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/dallaudit` | Connection string PG |
| `JWT_SECRET` | *(dev only)* | Secret de signature JWT — **obligatoire en prod** |
| `PORT` | `3001` | Port d'écoute |
| `FRONTEND_URL` | `http://localhost:5173` | Origine CORS autorisée |
| `LOG_LEVEL` | `info` | Niveau de log Fastify/Pino |

---

## Checklist mise en production

- [ ] `JWT_SECRET` aléatoire (min 32 chars)
- [ ] PostgreSQL avec backups configurés
- [ ] HTTPS (requis pour le Service Worker PWA)
- [ ] Nginx devant le backend avec `proxy_pass http://localhost:3001`
- [ ] `uploads/` monté sur volume persistant (ou migrer vers S3/MinIO)
- [ ] Changer le mot de passe admin par défaut

---

*DallAudit V3 — PWA offline-first pour audit de dallage industriel*
