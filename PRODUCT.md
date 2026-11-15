# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One React web app. It runs in a desktop or tablet browser, as the Windows `.exe` (local server + browser), and inside the Android APK (Chaquopy runs the Python server on the phone; a WebView shows the same web UI). The design language is web, not native Android.

## Users

Primary audience: **NASA Space Apps Challenge judges and viewers** watching a short demo (a 30-second pitch and a 3-minute walkthrough). When needs conflict, a judge understanding the idea at a glance wins.

The roles shown in that story:
- **Astronaut** (astronaut portal, `/crew`): a crew member on a long mission checking their own health and today's tasks on an onboard tablet.
- **Lab team** (lab-team portal, `/team`): flight surgeons, lab staff and psychologists on the ground reading every metric in detail, from a link-delayed copy.

## Product Purpose

SHMS (Space Health Management System) puts each astronaut's health data in one place and tells them what to do today. It works onboard without the ground (a Mars one-way delay can reach 22 minutes) and syncs when a link is available. Success: a viewer quickly grasps "one health hub per astronaut, works without Earth, every alert explains itself."

## Positioning

- Runs entirely onboard; the crew app never waits for the ground. The lab team sees the same data later, through a store-and-forward link with real delay.
- Transparent rules: every alert comes from a config-file rule (smoothed value vs personal baseline, slope, thresholds, cross-source rules) and shows its reason.
- Structured around NASA's LSAH (Lifetime Surveillance of Astronaut Health) program: its 50 test categories, mission phases and annual-exam rules (MR089S).

## Operating Context

- Demo flow: a start page to pick a portal, then Today, Exercise (live workout with heart rate and calories), Energy, Body, Food & water, Mind (check-in, reaction test), Return to Earth (post-landing balance readiness), plus the lab-team pages and a demo panel (mission profile, clock speed, event injection, jump to landing).
- Five fictional crew members named "Astronaut 1-5" (TR: "Astronot 1-5"), 10 preflight days, a 180-day mission and 21 days after landing, on a fast mission clock.

## Capabilities and Constraints

- Stack: FastAPI + SQLite backend, React + Vite + TypeScript + Tailwind + Recharts frontend; every value, threshold, rule and recommendation lives in `config/reference.yaml` with `source` and `verified`.
- All data is simulated. No real astronaut data is used (LSAH records are protected); values not from the brief's reference list carry an "unverified" tag.
- Current conventions (not declared binding by the user): permanent "SIMULATED DATA" label and "not a medical device" disclaimer; every alert shows its reason and source; large touch targets.
- Undecided: how far the redesign may change the lab-team portal (the current request targets the astronaut "Today" dashboard).

## Brand Commitments

- Name: **Space Health Management System (SHMS)**; TR: **Uzay Sağlık Yönetim Sistemi**.
- **English and Turkish on all text** (binding): every UI string goes through `t()` with a Turkish entry in `frontend/src/i18n/tr.ts`; server text has `_tr` twins; `npm run build` fails on a missing translation.

## Evidence on Hand

- NASA sources used for structure and reference values: npj Microgravity (2020, 2023), NTRS reports on urine chemistry and potassium citrate, NLSP LSAH "Medical Data Available for Request" and MR089S (see the Data sources page and README).
- No real users, testimonials or clinical validation exist; do not invent them.

## Product Principles

1. A judge must understand each screen in a few seconds.
2. Explain, don't decide: every warning shows why and where the rule comes from.
3. The crew never waits for Earth.
4. Honest about data: simulated values and unverified assumptions stay visibly labeled.
5. Bilingual by default: nothing ships without Turkish.
