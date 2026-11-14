# Crew Health Hub

**NASA Space Apps Challenge demo: a personal health hub for astronauts.** Each crew member sees their own health data in one place and gets one clear list of what to do today. It runs entirely onboard and syncs with the ground whenever a link is available.

> ⚠️ **This is a decision-support demo with simulated data. It is not a medical device and not for clinical use.**
> There is no real hardware. Every device feed comes from a simulator built on published astronaut data. Every screen shows a permanent **SIMULATED DATA** label.

Why onboard? On a deep-space mission, a one-way message to Earth can take up to ~22 minutes. The crew app never waits for the ground. Updates queue in an outbox and go out when the link is up.

---

## Run it

```bash
./run.sh            # first run sets everything up, then serves http://127.0.0.1:8000
```

- Crew app (tablet): <http://127.0.0.1:8000/>
- Flight surgeon view: <http://127.0.0.1:8000/surgeon>

On the first run, `run.sh` creates a Python virtual environment, installs the Python packages and the npm packages, and builds the UI. Later runs start in about a second.

| Command | What it does |
|---|---|
| `./run.sh` | Set up and start (FastAPI serves the built React app) |
| `./run.sh test` | Run the pytest suite |
| `./run.sh dev` | Backend on :8000 plus the Vite dev server with hot reload on :5173 |
| `PORT=9000 HUB_SEED=7 ./run.sh` | Use a different port or seed |

Requirements: Python 3.11+ and Node 18+. If `node` isn't on your PATH, `run.sh` also looks in `~/.local/node/bin`.

Every start uses a fresh simulation with the default seed (42) and opens on mission day 30. The clock runs at 1 mission day per 60 s.

---

## 3-minute demo script

| Time | Where | Do / say |
|---|---|---|
| 0:00 | **Today** (Lena Okafor, Commander) | One screen: a big **red** status, the alert banner *"Kidney-stone risk is high"* with its reason (stone risk > 2.0, urine < 2 L/day), today's tasks, last night's sleep, and live vitals. Point out the **SIMULATED DATA** badge. |
| 0:20 | Top bar → **Surgeon view** → Demo panel → **Pause** | Pausing gives you time to talk. Click **Crew app ›** to go back. |
| 0:30 | **Today** → *ARED – 45 min* → **Start live** | The live workout opens. Heart rate from the smart shirt climbs toward the target for the load. Tap **+** on Load, then **Log set** twice. The clock runs ×10 in demo time. |
| 1:00 | **Finish & log** | Summary: minutes, average and max heart rate, and weekly minutes against the ~600 min target. The strength and fitness trends are below. |
| 1:15 | **Body** | Live vitals, each next to its personal baseline. Sleep history shows less sleep in flight after launch. Core temperature is shown too. |
| 1:35 | **Lab** | The CaOx supersaturation chart has a 2.0 threshold line, the urine volume card is red, and both are linked to their NTRS sources. The **cross-source** alert recommends potassium citrate. Tap **Start & take dose**. |
| 1:55 | **Surgeon view** → **+7 days** → back to **Lab** | *"Is the supplement protocol working?"* The response score rises (about 0.1 → 0.7), and the days-to-target estimate comes from an exponential fit. Compare with **Yuki** (crew switcher), the scripted poor responder, whose score stays near 0 and who gets a *"not working well"* alert. |
| 2:25 | **Surgeon view** | Overview of all four crew members, protocol scores, trends, the correlation heatmap (tap *Water intake × Urine volume*), and the event log. |
| 2:40 | Demo panel → set the Mars delay slider to ~1 min, tap **Mars**, set the clock back to **1 day / 60 s** | The link panel shows packets **in flight** with a countdown, and the *"Newest data on ground"* age climbs past the delay. The crew cards freeze until packets arrive. Meanwhile the crew app keeps updating, because it never waits for the ground. |
| 3:00 | **Data sources** | Every reference value with its source, the list of **unverified** values, and live NASA OSDR related studies (with a cached fallback). |

Other things to show: **Inject event** (e.g. *Fever* or *CO2 spike*), **Devices → Simulate disconnect**, **Force link blackout**, a CSV import on **Devices**, and the Bluetooth heart-rate strap button in the live workout (Chrome/Edge over HTTPS or localhost).

---

## What's inside

```
config/reference.yaml   every value, threshold, rule, recommendation and protocol, each with source + verified
config/osdr_fallback.json   cached OSDR response used when the live API can't be reached
backend/app/
  sim/model.py          coupled physiology model (seeded, per crew per day)
  sim/world.py          mission clock, day cycle, tasks, protocols, live workouts, snapshots
  adapters/             one DeviceAdapter interface: read_day · live · status
                        ARED, T2, CEVIS, Bio-Monitor, Actiwatch, T-Mini, CO2, dosimeter, UWMS, manual, CSV
  engine/stats.py       EWMA, baseline mean/SD, z-score, slope, Pearson
  engine/rules.py       per-metric rules + cross-source rules + protocol rule → green/amber/red + reason
  engine/response.py    protocol response score + exponential fit for days to target
  link/groundlink.py    store-and-forward outbox: numbered packets, delay, blackout windows, acks
  services/osdr.py      NASA OSDR Biological Data API client with cache and fallback
  api/routes.py         REST + WebSocket (live heart rate)
frontend/src/           React + Vite + TypeScript + Tailwind + Recharts
```

**Simulator.** 4 crew members, 10 preflight baseline days and a 180-day mission. The sources affect each other:
- Exercise raises heart rate, sweat loss and the water target.
- Low water lowers urine volume, which raises specific gravity and stone risk.
- Missing ARED sessions makes urine calcium rise faster.
- Protocols change later urine samples, scaled by adherence (an EWMA of doses taken) and a per-person response factor.

Scripted events with the default seed:
- Lena: high stone risk.
- Marco: dehydration on days 26–32.
- Yuki: poor-sleep week on days 27–33, and a poor responder to potassium citrate from day 12.
- Sam: missed workouts on days 20–34, which fires the bone-loss cross-source rule.

The same seed and the same actions always give the same data. Tasks you don't confirm are completed by the simulated crew at their usual adherence ("demo autopilot", which can be switched per crew in the Demo panel).

**Rules.** For each metric: an EWMA-smoothed value, a z-score against the personal preflight baseline, a 7-day slope, and an anomaly flag. Thresholds come from `config/reference.yaml`. The four cross-source rules are:
- stone risk = supersaturation + urine volume
- bone loss = low ARED minutes + rising urine calcium
- exercise dehydration = exercise + water + specific gravity
- fatigue = sleep + resting heart rate

Every alert shows its reason and a recommendation from the fixed list.

**Response score.** For each target marker, `progress = 1 − |current − target| / |start − target|`, clipped to 0..1 and computed on EWMA values. The protocol score is the average over its markers. Days to target come from fitting `p(t) = p_max·(1 − e^(−t/τ))`. A value past the target in the wanted direction counts as reached (`stop_at_target: true` in the config). It measures how far urine markers have moved; it is **not** bioavailability.

**Ground link.** The ISS profile has a 0.5 s delay, Gateway 1.3 s, and Mars up to 22 min (adjustable). Each profile has periodic blackouts, and a blackout can also be forced. Delays run in **real time**, not on the fast mission clock, so the lag is visible. The surgeon view reads only data that has arrived through the link.

**OSDR.** The app calls `https://visualization.osdr.nasa.gov/biodata/api/v2/query/datasets/` with `study.characteristics.organism=Homo sapiens` plus the study title and description columns (`format=json.records`), then tags the studies by topic. Responses are cached for 6 h in `data/osdr_cache.json`. If the live call fails, the app uses that cache, or `config/osdr_fallback.json`.

**Tests.** `./run.sh test` runs 56 pytest tests covering:
- the simulator: seeding, coupling between sources, scripted events, the protocol flow, the live workout and link delay
- the rules: thresholds, z-score, slope, anomaly, cross-source and protocol rules, and config validation
- the response score: formula, clipping and the exponential fit
- API smoke tests

---

## Reference values (verified)

These are the only values marked `verified: true`:

- Exercise ~2 h/day; ~600 min/week across T2, CEVIS and ARED (range 450–720); ARED peak load 272 kg; T2 peak speed 19.3 km/h; intake 2296 ± 449 kcal/day — *npj Microgravity (2020, 2023)*
- Crew sleep less in flight than before or after — *NASA wearable technology*
- In flight, urine calcium is up to ~50% higher, and volume, pH and citrate are lower. Stone risk is higher under 2 L/day of urine and lowest above 2.5 L/day — *ntrs.nasa.gov/citations/20000084164, /20000020539*
- Potassium citrate 20 mEq/day as two 10 mEq pills with the last meal raises citrate by about 130–140 mg/day and pH by 0.2–0.3. Calcium oxalate supersaturation above 2.0 means higher risk — *ntrs.nasa.gov/citations/20090019087*

## Values still marked unverified

Everything else in `config/reference.yaml` has `verified: false` and shows an **unverified** tag in the UI. The same list appears on the **Data sources** page. There are 53 items:

**Models and settings**
- Simulation settings (seed, start day, clock speed, workout time scale ×10)
- All physiology model coefficients (water→urine volume, sweat loss, calcium rise shape, citrate/pH flight drop size, protocol onset, water target, heart-rate response, how much less crew sleep in flight, radiation dose rates, CO2 levels)
- The daily split of the exercise prescription (ARED 45 min + cardio 40 min). The 600 min/week target itself is verified.
- CEVIS maximum power (350 W)
- Food catalogue nutrient values
- **The CaOx supersaturation estimate.** It is a simplified formula from calcium, oxalate, citrate, pH and volume, not the EQUIL2 program. The 2.0 threshold is verified; the way the number is computed is not.

**Thresholds (28)**
- Sleep < 6.0 h amber, < 5.0 h red; sleep efficiency < 80%
- Resting heart rate z > 2 amber, > 3 red; breathing > 20/min; BP > 135/88
- SpO₂ < 95% amber, < 92% red; core temperature > 37.6 °C amber, > 38.0 °C red
- CO₂ > 3.0 mmHg amber, > 4.0 red; daily radiation > 5 mSv; cumulative > 250 mSv
- Urine calcium > +70% red; citrate < 450 mg/day; oxalate > 45 mg/day; uric acid > 800 mg/day; pH < 5.5; specific gravity > 1.025 amber, > 1.030 red; stone risk > 1.8 amber
- Water intake < 2.5 L; protein < 70 g; sodium > 4500 mg; feeling < 2.5

**Rules**
- Cross-source rules: bone-loss warning, exercise dehydration, fatigue risk. The stone-risk rule is verified.
- Protocol rule: response score below 0.35 after 14 days means "not working well".

**Recommendations**
- Resume ARED, reduce intensity, protect sleep, core-temperature check, check CO₂, radiation shelter, lower salt, flag for the flight surgeon.

**Targets and link**
- Nutrition targets: protein 90 g, sodium max 3500 mg, calcium 1000 mg, vitamin D 800 IU
- Link profiles: the ISS 0.5 s and Gateway 1.3 s delays, the Mars 22 min maximum, and all blackout windows. The delays come from the project brief, not the reference list.

To check a value, update its entry in `config/reference.yaml` (value, `source`, `verified: true`). The UI tag and this list follow the config automatically. The config loader refuses to start if any reference, rule, recommendation or target is missing `source` or `verified`.

---

*Decision-support demo with simulated data. Not a medical device and not for clinical use.*
