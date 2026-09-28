# Pasalho Sales Pilot

Independent field-sales proof-of-concept for Pasalho.

This repository contains:
- Sales rep PWA at `/`
- Independent sales control dashboard at `/control`
- Render-ready Node.js backend
- Neon/PostgreSQL persistence
- Rep and admin authentication
- Retailers, quantity pricing, orders, payments, outstanding/overdue and payment-time tracking

## Stack
Node.js + Express + PostgreSQL (Neon) + static PWA frontend.

## Run
```bash
cp .env.example .env
npm install
npm start
```

See the rest of this repository for deployment configuration and implementation details.
