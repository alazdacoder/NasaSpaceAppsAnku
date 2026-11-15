---
version: 1
slug: "frontend-src-pages-crew-today-tsx"
primary_target: "frontend/src/pages/crew/Today.tsx"
related_targets: ["frontend/src/components/Shell.tsx"]
---

# Surface: SHMS app shell and NFC card login (whole app)

Mode: Operate. Scope: replacement visual world for the whole web UI (login, astronaut portal, lab-team portal); first surface is the NFC card login at `/`.

Audience and job: hackathon judges watching a demo first; in the story, an astronaut taps a crew card on the station tablet/phone to open their own health space, or the lab team signs in on the ground. Manual sign-in (pick astronaut 1–5, lab team) stays available but low-key. A simulate-tap control serves PCs and phones without NFC. Native Android NFC arrives later through a JS bridge (`window.SHMS_onNfcTag(id)` / `shms-nfc` event).

Constraints: EN/TR on every string; runs offline in the Android WebView, so fonts are bundled, never fetched; simulated-data label and not-a-medical-device disclaimer stay visible; card IDs identify, they do not authenticate.

## Direction contract

THESIS: A crew health app lit like the cupola window in daylight: cloud-white ground, ocean-navy ink and the thin blue atmosphere line. It refuses the category's dark starfield-and-neon dashboard.

OWN-WORLD: Ground #F4F7FA, cards pure white with 1px #DCE5EE hairlines and a soft navy-tinted shadow; ink #0E2A47; secondary #4A6582; one atmosphere blue #2F7FD8 for the single primary action and selection, pale limb blue #7FC4F5 for glow; sun amber #E8A33D only for the card chip and highlights; state colours deepened for white (ok #17834F, warn #B45F00, bad #C62F45) and always paired with a shape and a word. One family, Public Sans, for display and data; tabular numerals; hairlines do structure instead of boxes.

STORY: The visitor sees Earth's curved limb, reads "Hold your crew card to the back of the device", taps (or simulates), sees the card confirmed with their name, and lands in their own Today screen. Every later page keeps the limb line in the header, so the world follows them.

FIRST VIEWPORT: Login. Top bar: SHMS mark left, mission day, ground-link delay and EN/TR right. Centre-top: 56–64px headline and one-line sub. Lower half: the Earth limb arc filling the width, with concentric reading rings and a white crew card glyph sitting on the limb; status line under it (standby, confirmed, unknown card). Bottom: quiet text row "No card? Choose astronaut · Lab team" and a small "Simulate a card tap" pill. On phones the limb sits lower and the manual row stays one tap away.

FORM: Cupola Daylight, position 6 of my ordered list (assigned by the roll); seed:458406eab3db7365. Raises kept: same scale and ground for every chart of one metric (botanical folio); every state readable without colour (exposure record); one type family with hairline structure (design annual). Signature move: the atmosphere limb line, drawn as the header's bottom edge across the app and doubling as mission progress (a bright point travels launch to landing); on login it is the full Earth arc with the reading rings.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
