<div align="center">

# TB DARVINKS API

### Field Sales & Distribution Management Platform

**Darvinks Healthcare Ltd** — Nigeria

[![Node.js](https://img.shields.io/badge/Node.js-v22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/NestJS-v11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-v7-2D3748?logo=prisma&logoColor=white)](https://prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)](https://neon.tech)
[![Tests](https://img.shields.io/badge/Tests-542%20passing-brightgreen)](/)
[![License](https://img.shields.io/badge/License-UNLICENSED-red)](/)

**Live API:** `https://api.darvinks.com/api/v1`  
**Swagger Docs:** `https://api.darvinks.com/api/v1/docs`  
**Health Check:** `https://api.darvinks.com/api/v1/health`

</div>

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [User Tiers](#user-tiers)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [Key Business Rules](#key-business-rules)
- [Running Tests](#running-tests)
- [Deployment](#deployment)
- [Project Structure](#project-structure)

---

## The Problem

Darvinks Healthcare Ltd operates a nationwide distribution network across Nigeria with hundreds of field sales agents, Key Distributors (KDs), and warehouse locations. Before this platform, all commercial activity happened on paper or via WhatsApp:

- Field agents submitted daily sales reports via WhatsApp messages
- Purchase orders were raised on paper and physically carried to managers
- Cash collections were recorded in notebooks with no real-time visibility
- Attendance was tracked manually with no GPS verification
- Target assignment and performance tracking required manual spreadsheet work
- Management had no real-time view of what was happening across territories
- Invoice verification was done by eye, creating fraud opportunities
- Competitor intelligence was collected informally and never centralised

The result was delayed decisions, data loss, fraud exposure, and no single source of truth for the business.

---

## The Solution

TB DARVINKS digitalises the entire field sales operation into a single, role-aware REST API:

- **GPS-verified attendance** — agents clock in/out with a mandatory selfie and GPS coordinates. The server resolves the address via Google Maps and flags late arrivals automatically
- **End-to-end Purchase Order lifecycle** — from creation through OCR invoice verification, Sales Head approval, payment recording, delivery confirmation, to fully paid
- **Real-time collections** — cash collected in the field updates the KD's balance instantly
- **Cascading target system** — Sales Head assigns monthly targets by category; each tier splits them down to the agents beneath them. Every target must balance exactly
- **Competitor intelligence** — field agents submit text/photo/video competitor reports that feed a live Sales Head intelligence view
- **Automated analytics** — weekly PowerPoint and Excel performance reports generated automatically every Monday morning, downloadable on demand
- **Warehouse management** — real-time stock levels, inbound recording, low-stock alerts on the admin dashboard
- **Digital ID cards** — PDF identity cards generated automatically after registration and stored on Cloudinary

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Layer                             │
│          Mobile App  |  Web App  |  Admin Panel            │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────┐
│                   TB DARVINKS API                           │
│                   NestJS + TypeScript                       │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │   Auth   │  │  Sales   │  │ Analytics│  │Dashboard │  │
│  │ Module   │  │ Modules  │  │  Module  │  │  Module  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              BullMQ Job Queue (Redis)               │   │
│  │  ID Card Gen | OCR Comparison | Analytics Reports  │   │
│  └─────────────────────────────────────────────────────┘   │
└──────┬──────────────┬──────────────┬──────────────┬────────┘
       │              │              │              │
  ┌────▼────┐   ┌─────▼─────┐ ┌────▼────┐  ┌─────▼─────┐
  │  Neon   │   │Cloudinary │ │ Google  │  │ Firebase  │
  │Postgres │   │  CDN      │ │  APIs   │  │   FCM     │
  │(Primary)│   │(Files)    │ │Maps+    │  │ (Push     │
  │         │   │           │ │Vision   │  │  Notifs)  │
  └─────────┘   └───────────┘ └─────────┘  └───────────┘
```

### Key Design Decisions

**Region-scoped data access** — every field agent is assigned a region at registration (derived from their state, never self-selected). They can only see customers, sales data, and reports within their own region. Cross-region access requires an explicit Out-of-Region Request approved by a Sales Head or ZSM.

**BigInt for all monetary values** — all kobo amounts are stored as PostgreSQL `BigInt` to handle invoices exceeding ₦21 million (the 32-bit integer limit). The API serialises BigInt to Number automatically in responses — frontend divides by 100 to display in Naira.

**Fire-and-forget background jobs** — OCR invoice comparison, ID card generation, and analytics reports run as BullMQ background jobs. The API responds immediately; clients poll for the updated result.

**Strict state machine for Purchase Orders** — `PENDING_APPROVAL → APPROVED → PAYMENT_RECEIVED → DO_UPLOADED → DELIVERED → FULLY_PAID`. Any attempt to skip a step returns 400. This prevents fraud and ensures a clear audit trail.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | NestJS v11 + TypeScript 5.8 | API server, dependency injection, decorators |
| **ORM** | Prisma v7 + `@prisma/adapter-pg` | Type-safe database access with serverless Neon adapter |
| **Database** | Neon PostgreSQL (serverless) | Primary data store |
| **Queue** | BullMQ + Redis Cloud | Background jobs — ID cards, OCR, analytics |
| **File Storage** | Cloudinary | Photos, invoices, ID cards, competitor media, reports |
| **Maps** | Google Maps Geocoding API | Reverse geocoding GPS → street address |
| **OCR** | Google Vision API | Invoice text extraction and PO comparison |
| **Push** | Firebase Admin SDK | FCM push notifications |
| **Auth** | JWT (access + refresh tokens) | Stateless authentication with logout invalidation |
| **Validation** | class-validator + class-transformer | DTO validation pipeline |
| **Documentation** | Swagger / OpenAPI 3.0 | Interactive API docs with response examples |
| **Testing** | Jest + ts-jest | 542 unit tests across 17 test suites |
| **Deployment** | Render.com | Auto-deploy from GitHub on push to main |

---

## User Tiers

The platform has 8 distinct user types. Every data access rule, every approval flow, and every dashboard view is determined by tier.

| Tier | Role(s) | Access | Registration |
|---|---|---|---|
| **TIER1** | Merchandiser, Promoter, DBSR, VSR | Clock in/out, KD visits, secondary sales, competitor reports | Self-register |
| **TIER2** | Sales Representative, SSR | All Tier1 + create customers (GPS), purchase orders, collections | Self-register |
| **TIER3** | ATSM, TSM | All Tier2 + manage Tier2 team + split targets | Self-register |
| **TIER4** | Zonal Sales Manager | All Tier3 + manage Tier3 team + approve OOR requests | Self-register |
| **TIER5_SALES_HEAD** | Sales Head | Approve POs, assign root targets, competitor feed, org-wide view | Admin invite |
| **TIER5_SALES_SUPPORT** | System Admin | Full platform access, provision users, manage products | Admin invite |
| **TIER6_GM** | General Manager | Read-only org-wide view, download reports | Admin invite |
| **WAREHOUSE_ADMIN** | Warehouse Admin | Record stock, view movements, warehouse dashboard | Admin invite |

> **Teams:** All users belong to either **BRIGHT** or **RADIANT**. Managers can only link direct reports within their own team. Target cascading and org hierarchy are team-scoped.

---

## Getting Started

### Prerequisites

- Node.js v22+
- npm v10+
- A Neon PostgreSQL database
- A Redis Cloud instance
- A Cloudinary account
- Google Cloud project with Maps Geocoding API and Vision API enabled
- Firebase project with FCM enabled

### Installation

```bash
# Clone the repository
git clone https://github.com/omaks45/darvinks-app.git
cd darvinks-app

# Install dependencies
npm install

# Copy the environment template and fill in your values
cp .env.example .env
```

### Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# Seed the System Admin account
npm run prisma:seed

# Backfill legacy Lagos region data (if migrating from older data)
npm run migrate:lagos

# Seed Nigerian market locations (60+ towns across all regions)
npm run seed:locations
```

### Start the development server

```bash
npm run start:dev
```

The API will be available at `https://api.darvinks.com/api/v1`  
Swagger docs at `https://api.darvinks.com/api/v1/docs`

---

## Environment Variables

Create a `.env` file in the project root. All variables marked **required** must be set for the server to start in production.

```env
# ── Application ────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
API_PREFIX=api/v1

# ── Database ───────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://neondb_owner:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require

# ── JWT ────────────────────────────────────────────────────────────────────────
JWT_ACCESS_SECRET=your-access-secret-minimum-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-minimum-32-chars
JWT_ACCESS_EXPIRY=12h
JWT_REFRESH_EXPIRY=30d

# ── Redis (use REDIS_URL for Redis Cloud TLS in production) ────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL=rediss://default:password@redis-xxx.ec2.cloud.redislabs.com:17910

# ── Cloudinary ─────────────────────────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# ── Google APIs ────────────────────────────────────────────────────────────────
GOOGLE_MAPS_API_KEY=your-maps-api-key
# Path to service account JSON file OR inline JSON string
GOOGLE_APPLICATION_CREDENTIALS=secrets/google-vision-key.json

# ── Firebase ───────────────────────────────────────────────────────────────────
FIREBASE_SERVICE_ACCOUNT=secrets/firebase-key.json

# ── Email (SMTP) ───────────────────────────────────────────────────────────────
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your-email@gmail.com
MAIL_PASSWORD=your-gmail-app-password
MAIL_FROM=no-reply@darvinks.com
MAIL_FROM_NAME=Darvinks Healthcare

# ── App ────────────────────────────────────────────────────────────────────────
APP_INVITE_BASE_URL=https://api.darvinks.com/api/v1/auth/register/invite
BCRYPT_ROUNDS=12
```

> **Security:** Never commit `.env` or the `secrets/` folder to Git. Both are in `.gitignore`.

---

## API Reference

All endpoints are prefixed with `/api/v1`. Every response is wrapped in a standard envelope:

```json
{
  "success": true,
  "data": { },
  "timestamp": "2026-08-02T12:00:00.000Z"
}
```

Error responses follow the same envelope:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Human-readable error description",
  "error": "Bad Request",
  "path": "/api/v1/...",
  "timestamp": "2026-08-02T12:00:00.000Z"
}
```

### Authentication

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/auth/roles` | List all selectable roles for registration dropdown | Public |
| POST | `/auth/register` | Self-register as field staff (Tier 1–4) | Public |
| POST | `/auth/login` | Login and receive access + refresh tokens | Public |
| POST | `/auth/refresh` | Refresh access token | Public |
| POST | `/auth/logout` | Invalidate current session | Bearer |
| POST | `/auth/change-password` | Change password (mandatory for first-time invited users) | Bearer |
| POST | `/auth/forgot-password` | Send OTP to email | Public |
| POST | `/auth/verify-otp` | Verify OTP | Public |
| POST | `/auth/reset-password` | Reset password with OTP | Public |
| GET | `/auth/invite/:token` | Preview invite details before registration | Public |
| POST | `/auth/register/invite` | Register via invite token (back-office roles) | Public |

### User Management

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/users/me` | Get own profile + idCardUrl | Bearer |
| PATCH | `/users/me` | Update own profile / photo | Bearer |
| GET | `/users` | List all users | Bearer |
| GET | `/users/:id` | Get user by ID | Bearer |
| GET | `/users/reports/search` | Search for a user to link as direct report | Bearer |
| GET | `/users/reports/mine` | Get own direct reports | Bearer |
| POST | `/users/reports/:userId` | Link a user as direct report (same team, correct tier) | Bearer |
| DELETE | `/users/reports/:userId` | Remove a direct report link | Bearer |

### Admin

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/admin/invites` | Send invite to back-office roles | Admin |
| GET | `/admin/users` | List all users | Admin |
| GET | `/admin/users/:id` | Get user detail | Admin |
| PATCH | `/admin/users/:id` | Update user | Admin |
| PATCH | `/admin/users/:id/deactivate` | Deactivate user | Admin |
| PATCH | `/admin/users/:id/reactivate` | Reactivate user | Admin |
| POST | `/admin/users/:id/reset-password` | Reset user password | Admin |
| GET | `/admin/provisioned` | List provisioned (back-office) users | Admin |

### Attendance

> **All write operations require multipart/form-data with a `photo` file field**

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/attendance/clock-in` | Clock in with GPS + photo | Tier 1–4 |
| POST | `/attendance/clock-out` | Clock out with GPS + photo | Tier 1–4 |
| POST | `/attendance/kd-visit` | Record a KD visit (Tier 1 only) | Tier 1 |
| POST | `/attendance/sync` | Batch sync offline attendance events | Tier 1–4 |
| GET | `/attendance` | Get attendance history | Bearer |

### Products

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/products` | Create product | Admin only |
| GET | `/products` | List all active products | Bearer |
| GET | `/products/:id` | Get product detail | Bearer |
| PATCH | `/products/:id` | Update product | Admin only |
| PATCH | `/products/:id/deactivate` | Deactivate product | Admin only |
| PATCH | `/products/:id/reactivate` | Reactivate product | Admin only |

### Customers (Key Distributors)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/customers` | Create KD — Tier 1–4 use GPS, Admin types address | Bearer + Clock-in |
| GET | `/customers` | List KDs — field staff see own region only | Bearer |
| GET | `/customers/:id` | Get KD detail | Bearer |
| PATCH | `/customers/:id` | Update KD | Bearer |
| PATCH | `/customers/:id/deactivate` | Deactivate KD | Bearer |
| PATCH | `/customers/:id/reactivate` | Reactivate KD | Bearer |
| POST | `/customers/:id/out-of-region` | Request access to a KD outside own region | Tier 1–4 |
| PATCH | `/customers/out-of-region/:id/approve` | Approve OOR request | Sales Head / Tier 4 |
| GET | `/customers/out-of-region/pending` | List pending OOR requests | Sales Head / Tier 4 |

### Purchase Orders

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/purchase-orders` | Create PO — requires clock-in | Tier 1–4 |
| GET | `/purchase-orders` | List POs — field staff see own; admins see all | Bearer |
| GET | `/purchase-orders/:id` | Get full PO detail including items and payments | Bearer |
| PATCH | `/purchase-orders/:id/documents` | Upload KD invoice/cheque/DO (multipart file) | Bearer |
| PATCH | `/purchase-orders/:id/qualify` | Manually qualify/disqualify invoice | Sales Head |
| PATCH | `/purchase-orders/:id/approve` | Approve PO (requires qualified invoice) | Sales Head |
| POST | `/purchase-orders/:id/payments` | Record a payment against the PO | Bearer |
| PATCH | `/purchase-orders/:id/deliver` | Mark as delivered (sets 30-day payment deadline) | Admin |
| PATCH | `/purchase-orders/:id/cancel` | Cancel PO | Creator or Admin |

**Purchase Order Status Flow:**
```
PENDING_APPROVAL → APPROVED → PAYMENT_RECEIVED → DO_UPLOADED → DELIVERED → FULLY_PAID
```

### Collections

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/collections` | Record cash collection — reduces KD balance | Tier 1–4 |
| GET | `/collections` | List collections | Bearer |
| GET | `/collections/summary/:customerId` | KD balance + total collected summary | Bearer |

### Secondary Sales

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/secondary-sales` | Log sell-through at a KD location — requires clock-in | Tier 1–4 |
| GET | `/secondary-sales` | List secondary sales | Bearer |
| GET | `/secondary-sales/:id` | Get secondary sale detail | Bearer |

### Competitor Reports

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/competitor-reports` | Submit report — TEXT as JSON, IMAGE/VIDEO/PDF as multipart | Tier 1–4 |
| GET | `/competitor-reports` | List reports — field staff see own; Sales Head sees all | Bearer |
| GET | `/competitor-reports/:id` | Get report detail | Bearer |

### Target Assignments

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/target-assignments/root` | Bulk-assign targets by category to a Tier 4 ZSM | Sales Head |
| POST | `/target-assignments/:id/split` | Split a received target among direct reports | Bearer |
| PATCH | `/target-assignments/:id` | Update target (flags children stale if value changes) | Assigner |
| GET | `/target-assignments` | List assignments | Bearer |
| GET | `/target-assignments/:id` | Get assignment detail with children | Bearer |
| GET | `/target-assignments/my-performance` | Personal TGT/ACHV/BAL per category for a month | Bearer |

### Warehouse

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/warehouse/inbound` | Record inbound stock | Warehouse Admin / Admin |
| POST | `/warehouse/adjust` | Adjust stock (positive or negative) | Warehouse Admin / Admin |
| GET | `/warehouse/stock` | View current stock levels | Bearer |
| GET | `/warehouse/movements` | View stock movement history | Bearer |

### Locations

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/locations` | Create a market town / location | Admin / Sales Head |
| GET | `/locations` | List all seeded Nigerian locations | Bearer |
| GET | `/locations/:id` | Get location detail | Bearer |
| PATCH | `/locations/:id` | Update location | Admin / Sales Head |
| DELETE | `/locations/:id` | Delete location (blocked if customers reference it) | Admin |

### Location Targets

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/location-targets` | Set monthly target per location per category (upsert) | Admin / Sales Head |
| GET | `/location-targets` | List targets by period | Bearer |
| GET | `/location-targets/:id` | Get target detail | Bearer |

### Dashboard

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/dashboard?year=2026&month=7` | Polymorphic dashboard — shape varies by tier | Bearer |

**Response shapes by tier:**

- **Tier 1–4:** `clockedInToday`, `myPerformance` (TGT/ACHV/BAL), `myTeam` (direct reports + rollup), `recentActivity`
- **Sales Head:** `approvalQueue` (pending POs + OOR), `myTeam` (full downstream tree + rollup), `competitorActivityFeed`
- **Admin / GM:** `organisationSummary`, `approvalQueue` counts, `warehouseAlerts`, `users` list
- **Warehouse Admin:** `stockSummary`, `recentMovements`

### Analytics

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/analytics/report/ppt` | Download PowerPoint report | Bearer |
| GET | `/analytics/report/excel` | Download Excel report | Sales Head / Admin |
| POST | `/analytics/trigger` | Manually trigger report generation | Admin |

Query parameters: `periodType=monthly|weekly|quarterly|annual` and `period=2026-07` (monthly), `period=2026-Q3` (quarterly), `period=2026` (annual).

---

## Authentication

The API uses **JWT Bearer tokens** with a two-token pattern.

### Login flow

```bash
# 1. Login
POST /api/v1/auth/login
{
  "email": "agent@darvinks.com",
  "password": "YourPassword123!"
}

# Response
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "12h"
  }
}

# 2. Use the access token on every protected request
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 3. Refresh when expired
POST /api/v1/auth/refresh
{ "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

### Token lifetimes

| Token | Lifetime | Notes |
|---|---|---|
| Access token | 12 hours | Sent on every request |
| Refresh token | 30 days | Used only to get a new access token |

Logout invalidates all tokens issued before the logout timestamp — stolen tokens become useless the moment the real user logs out.

### First-time invited users

Accounts created via invite (`POST /auth/register/invite`) have `mustChangePassword: true`. The app must detect this in the login response and redirect to `POST /auth/change-password` before allowing any other action.

---

## Key Business Rules

### Money — always in Kobo

All monetary values are stored and returned as integers in **kobo** (₦1 = 100 kobo). Never store or send fractional naira.

```
Display:  ₦22,230,000
API:      totalKobo: 2223000000
Formula:  display = API value ÷ 100
```

### Clock-in gate

Field agents (Tier 1–4) must clock in before they can log secondary sales, create customers, submit competitor reports, or create purchase orders. The API returns `403 Forbidden` with the message `"You must clock in before performing this action"` if the agent has not clocked in today.

### Region scoping

When a field agent self-registers with a state (e.g. `"lagos"`), the system automatically assigns them to a region (`SOUTH_WEST`). They can only:
- Create customers in their own region (GPS is validated against the agent's region)
- View customers in their own region
- Submit reports tagged to their region

Cross-region customer access requires an Out-of-Region Request approved by a Sales Head or Tier 4 ZSM.

### Target cascade sum rule

When splitting a target down the hierarchy, the **sum of all child allocations must exactly equal the parent target**. Any discrepancy returns `400 Bad Request`. If a manager later updates the parent target value, all child assignments are automatically flagged `isStale: true` — they must re-split.

### Purchase Order state machine

Transitions are strictly enforced:

```
PENDING_APPROVAL  →  APPROVED          (Sales Head — requires qualified invoice)
APPROVED          →  PAYMENT_RECEIVED  (auto on first payment)
PAYMENT_RECEIVED  →  DO_UPLOADED       (auto on delivery order upload)
DO_UPLOADED       →  DELIVERED         (Admin — sets 30-day payment deadline)
DELIVERED         →  FULLY_PAID        (auto when paidKobo === totalKobo)
Any state         →  CANCELLED         (creator or Admin — blocked after payment)
```

### OCR invoice verification

When a field agent uploads a KD invoice photo, the system:
1. Uploads the image to Cloudinary
2. Queues an OCR background job
3. Returns the updated PO immediately (qualification still `PENDING`)
4. After 2–5 seconds, Vision API extracts text and compares quantities against PO line items
5. Sets qualification to `QUALIFIED` or `NOT_QUALIFIED`
6. Sales Head can always manually override the qualification before approving

### ID card generation

Digital ID cards are generated as PDFs immediately after registration — not during. The registration response includes a message that the card will be ready shortly. Poll `GET /users/me` until `idCardUrl` is populated (typically 2–5 seconds).

---

## Running Tests

```bash
# Run all 542 tests
npm test

# Run with coverage report
npm run test:cov

# Run a specific module
npm test -- --testPathPattern="purchase-order.service"
npm test -- --testPathPattern="customer.service"
npm test -- --testPathPattern="dashboard.service"

# Watch mode
npm run test:watch
```

**Test coverage by module:**

| Module | Tests |
|---|---|
| Purchase Orders | 68 tests |
| Customers | 73 tests |
| Attendance | 38 tests |
| Auth | 34 tests |
| Dashboard | 44 tests |
| Target Assignments | 51 tests |
| Analytics | 27 tests |
| Warehouse | 22 tests |
| Users | 28 tests |
| Collections | 22 tests |
| Secondary Sales | 18 tests |
| Competitor Reports | 32 tests |
| Locations | 22 tests |
| Location Targets | 19 tests |
| Admin | 30 tests |
| App | 2 tests |

---

## Deployment

The API deploys automatically to **Render.com** on every push to the `main` branch.

### Manual deployment

```bash
# 1. Ensure all tests pass
npm test

# 2. Build the production bundle
npm run build

# 3. Verify the build
node -r ./tsconfig-paths-bootstrap.js dist/main.js

# 4. Push to GitHub — Render auto-deploys
git add .
git commit -m "your changes"
git push
```

### Render settings

| Setting | Value |
|---|---|
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `node -r ./tsconfig-paths-bootstrap.js dist/main.js` |
| **Health Check Path** | `/api/v1/health` |
| **Region** | Frankfurt (EU) |

### Database migrations on deploy

Migrations run automatically as part of the build:

```json
"build": "prisma generate && tsc -p tsconfig.json"
```

For first-time setup on a new environment:

```bash
npx prisma migrate deploy
npm run prisma:seed
npm run seed:locations
```

---

## Project Structure

```
tb-darvinks-api/
├── prisma/
│   ├── schema.prisma              # Database schema — single source of truth
│   ├── seed.ts                    # Seeds System Admin account
│   ├── seed-locations.ts          # Seeds 60+ Nigerian towns
│   └── backfill-lagos-region.ts   # One-time Lagos region migration
│
├── src/
│   ├── main.ts                    # Application entry point
│   ├── app.module.ts              # Root module
│   │
│   ├── common/
│   │   ├── config/
│   │   │   ├── app.config.ts      # Typed configuration factory
│   │   │   └── env.validation.ts  # Startup env var validation
│   │   ├── decorators/            # @CurrentUser(), @Roles()
│   │   ├── filters/               # GlobalExceptionFilter
│   │   ├── google/                # GoogleMapsService, GoogleVisionService
│   │   ├── guards/                # JwtAuthGuard, ClockInGuard, RolesGuard
│   │   ├── interceptors/          # TransformInterceptor (response envelope)
│   │   ├── prisma/                # PrismaService
│   │   └── utils/
│   │       ├── region.util.ts     # State → region mapping
│   │       ├── role.utils.ts      # Role → tier mapping
│   │       └── attendance-window.util.ts
│   │
│   └── modules/
│       ├── admin/                 # User provisioning, invite management
│       ├── analytics/             # PPT/Excel reports + weekly scheduler
│       ├── attendance/            # Clock-in/out, KD visits, sync
│       ├── auths/                 # Registration, login, JWT, password flows
│       ├── cloudinary/            # File upload service
│       ├── collections/           # Cash collection recording
│       ├── competitor-report/     # Field intelligence reporting
│       ├── customer/              # KD management + OOR requests
│       ├── dashboard/             # Polymorphic tier-aware dashboard
│       ├── email/                 # SMTP email service
│       ├── location/              # Market towns / locations
│       ├── location-target/       # Monthly targets per location
│       ├── notifications/         # BullMQ notification processor + ID card worker
│       ├── products/              # SKU catalogue management
│       ├── purchase/              # PO lifecycle management
│       ├── secondary-sales/       # Sell-through activity logging
│       ├── target-assignment/     # Cascading target system
│       ├── tokens/                # JWT token service
│       ├── user/                  # User profiles + org hierarchy
│       └── warehouse/             # Stock management
│
├── secrets/                       # Git-ignored — API keys (local only)
│   ├── google-vision-key.json
│   └── firebase-key.json
│
├── tsconfig.json                  # rootDir: ./src → output: dist/
├── tsconfig-paths-bootstrap.js    # Path alias resolver for production
└── package.json
```

---

## Regions

The platform covers all Nigerian regions:

| Region | States |
|---|---|
| `SOUTH_WEST` | Lagos, Oyo, Ogun, Osun, Ondo, Ekiti |
| `NORTH_BRIGHT` | Kogi, Benue, Nasarawa, Adamawa, Taraba |
| `NORTH_CENTRAL` | FCT (Abuja), Niger, Plateau, Kwara |
| `NORTH_WEST` | Kano, Kaduna, Sokoto |
| `SS1` | Abia, Cross River, Akwa Ibom |
| `SS2` | Imo, Rivers, Bayelsa |
| `SS3` | Delta, Edo |
| `SE1` | Enugu, Ebonyi, Anambra |

Teams map to regions:
- **RADIANT:** SOUTH_WEST, NORTH_CENTRAL, NORTH_WEST
- **BRIGHT:** NORTH_BRIGHT, SS1, SS2, SS3, SE1

---

## Contributing

This is a private project for Darvinks Healthcare Ltd. For issues or feature requests, contact the development team.

---

## License

UNLICENSED — Private and proprietary. All rights reserved.  
© 2026 Darvinks Healthcare Ltd.

---

<div align="center">

Built with for Darvinks Healthcare Ltd  
**API Version:** 1.0.0 | **Phase:** 1–4 Complete | **Tests:** 542 passing

</div>