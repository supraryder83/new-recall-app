# Canada Recall Alert (Alerte Rappel Canada) 🇨🇦

A progressive web app (PWA) built with **React**, **Vite**, **Tailwind CSS**, and **Lucide Icons** that tracks product, vehicle, medical, and food safety recalls across Canada in real-time. Features instant client-side IndexedDB caching, camera barcode scanning, and multimodal AI recognition powered by **Google Gemini 3.5 Flash Lite** (`@google/genai`).

---

## 📱 Fully Responsive Multi-Device Architecture

The application provides a tailored user experience depending on device viewport:

### 1. Mobile Phone Experience (`< 768px`)
- **Native Phone App Shell**: 100% full-bleed mobile interface.
- **Compact Top Bar**: Stylized Canadian Maple Leaf & Alert Shield logo, live sync count pill, and quick settings.
- **Native Bottom Navigation Bar**:
  - **Alerts**: Real-time safety recall feed.
  - **Categories**: Browse safety departments (CFIA, Transport Canada, Health Canada).
  - **Scan (Center Action)**: Prominent elevated crimson Canadian action button.
  - **AI Vision**: Direct trigger for Gemini multimodal photo verification.
  - **Settings**: Offline IndexedDB cache tools and Gemini API key management.
- **Mobile Bottom Sheet**: Recall details slide up smoothly as an iOS/Android bottom sheet with drag handle.

### 2. Desktop & Tablet Experience (`≥ 768px`)
- **Desktop Navigation Sidebar**:
  - Canadian Maple Leaf emblem and branding.
  - Prominent "Scan Product" primary button.
  - Active navigation links with live record counter badges.
  - Database status card showing IndexedDB cache statistics, last sync time, and 1-click refresh.
- **Desktop Top App Bar**:
  - Real-time safety feed header with live status badge.
  - Quick action buttons for barcode scanner and Gemini AI configuration.
- **Multi-Column Cards Grid**:
  - 2 to 3 column responsive grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3`) with smooth hover interactions.
- **Centered Modal Dialog**:
  - Detail modal centers as a spacious desktop dialog with complete Canada.ca hazard warnings, official instructions, and share options.

---

## ✨ Core Features

- **🇨🇦 Canadian Identity**: Crimson red accents (`#dc2626`), deep slate tones (`#111827`), and custom Maple Leaf & Alert Shield SVG branding.
- **⚡ 100% Client-Side Data & Offline-First**:
  - Ingestion from the official [recalls-rappels.canada.ca](https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json) Open Data feed.
  - Automatic caching of 34,000+ recall notices in browser **IndexedDB** with timestamps.
  - Pre-bundled offline dataset fallback (`/data/initial-recalls.json`) and resilient multi-gateway proxy fallback so the app works even offline or in CORS-restricted environments.
- **🔍 Real-Time Search & Category Filters**:
  - Search by product name, brand, issue, hazard, or batch/lot number with token-based fuzzy matching.
  - Category filters: **All**, **Food & Nutrition** (CFIA), **Consumer Products** (Health Canada), **Health & Medical**, and **Vehicles & Transport** (Transport Canada).
  - Risk class filtering (**Class 1** - serious hazard, **Class 2**, **Class 3**).
- **📷 Camera Barcode & UPC Scanner**:
  - Direct camera access via standard browser `navigator.mediaDevices.getUserMedia`.
  - Native `BarcodeDetector` API for UPC-A, EAN-13, EAN-8, and Code 128 barcodes.
  - Automatic instant querying against the Canadian recall dataset with haptic feedback and celebratory confetti on safe scans.
- **✨ Multimodal Gemini 3.5 Flash Lite Vision Inspector**:
  - Snap photos or upload images of grocery labels, appliance stickers, or vehicle VIN plates.
  - Structured extraction of `brand`, `productName`, `modelOrBatchNumber`, and `detectedCategory` using `@google/genai`.
  - Instant cross-referencing against the full Canadian safety database returning an official verdict card (*"Potential Recall Detected!"* vs. *"No Active Recall Detected in Dataset"*).
  - 1-Click interactive demo buttons to test recognition with zero setup.
  - Clean API key settings modal (with Google AI Studio link) persisted securely in `localStorage`.
- **📱 Progressive Web App (PWA)**:
  - Configured with `vite-plugin-pwa` and Workbox service worker caching.
  - Full `manifest.webmanifest` with 192x192, 512x512, and maskable icons.
  - In-app "Install App" banner and header button responding to `beforeinstallprompt`.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v22)
- **npm** v9+

### 2. Installation
```bash
npm install
```

### 3. Environment Variables (Optional)
Create a `.env` file or set:
```bash
VITE_GEMINI_API_KEY=AIzaSy...
```
*(If omitted, users can configure their key via the in-app modal saved to localStorage).*

### 4. Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser. (The 6-hour background sync worker and pipeline API are integrated into the Vite dev server).

### 5. Background Sync Worker CLI
```bash
# Run one-off sync pipeline immediately (fetches 24h window, deduplicates, reverse-lookups watchlist, and dispatches Web Push)
npm run sync

# Run standalone background sync daemon on cron (0 */6 * * *)
npm run worker

# Run comprehensive automated pipeline test suite
npm run test:pipeline
```

### 6. Production Build
```bash
npm run build
npm run preview
```

---

## ⏰ 6-Hour Background Sync Worker & Reverse-Lookup Notification Pipeline

The background sync pipeline operates on a scheduled cron cadence (`0 */6 * * *`) and executes the following stages:

1. **Cron / Scheduled Worker**:
   - Scheduled job running every 6 hours (`0 */6 * * *`, America/Toronto timezone).
   - Queries the official Health Canada Open Data feed (`HCRSAMOpenData.json`) for records published or modified within the last 24 hours.
   - Deduplicates incoming recall IDs against the persistent `processed_recalls` store (`data/pipeline-store.json`) to prevent redundant runs.

2. **Ingestion & Normalization**:
   - Extracts and normalizes: Recall ID (`NID`), title, category, publication date, and official URL.
   - Extracts structured brand names, model numbers, UPCs/barcodes (8–14 digits), and lot codes from descriptions, converting to lowercase alphanumeric tokens for high-speed indexing.

3. **Reverse Lookup Matching**:
   - Queries the user `watchlist` collection against incoming normalized recall batches.
   - Match criteria:
     - **Exact match on UPC/barcode** (Highest priority, score: 100).
     - **Normalized substring or exact match on model numbers** (score: 90–95).
     - **Tokenized fuzzy match on brand + product keywords** (score: 75–85).
   - Groups matched items by user ID to prevent spamming multiple notifications per cycle.

4. **Notification Dispatch (PWA Web Push)**:
   - Retrieves active Web Push API subscriptions (`PushSubscription` endpoint and p256dh/auth keys) using RFC 8291 / RFC 8292 VAPID encryption.
   - Dispatches payloads:
     - Title: `Product Recall Alert: [Product Name]`
     - Body: Summary of recall reason and hazard.
     - Data payload: Deep link URL pointing directly to the recall details view (`/recalls/:id`).
   - Logs matches in the user's `notification_history` table and marks alerts as sent.

5. **Error Handling & Rate Limiting**:
   - Exponential backoff retry logic with jitter on external feed fetching.
   - Automatic pruning and cleanup of expired or invalid push subscriptions (HTTP 404 / 410 Gone).

---

## 🇨🇦 Data Source & Licensing
Safety recall notifications and open datasets are sourced under the **Open Government Licence – Canada** from:
- [Health Canada (Santé Canada)](https://www.canada.ca/en/health-canada.html)
- [Canadian Food Inspection Agency (CFIA)](https://inspection.canada.ca/)
- [Transport Canada](https://tc.canada.ca/)
- Live Open Data JSON Endpoint: `https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json`
