# SHMS — Space Health Management System

**NASA Space Apps Challenge demo: a personal health hub for astronauts.** Each crew member sees their own health data in one place and gets one clear list of what to do today. The ground lab team sees everything in detail. The app runs entirely onboard and syncs with the ground whenever a link is available.

> ⚠️ **This is a decision-support demo with simulated data. It is not a medical device and not for clinical use.**
> There is no real hardware. Every device feed comes from a simulator built on published astronaut data. Every screen shows a permanent **SIMULATED DATA** label.

Why onboard? On a deep-space mission, a one-way message to Earth can take up to ~22 minutes. The crew app never waits for the ground. Updates queue in an outbox and go out when the link is up.

**Languages:** English and Turkish (Türkçe). Use the **EN / TR** switch at the top of every screen. A link can also choose the language: <http://127.0.0.1:8000/crew?lang=tr>.

---

## Run it

```bash
./run.sh            # first run sets everything up, then serves http://127.0.0.1:8000
```

| Address | What it is |
|---|---|
| <http://127.0.0.1:8000/> | Start page: choose a portal, switch language |
| <http://127.0.0.1:8000/crew> | **Astronaut portal** (onboard tablet): simple, only what the crew member needs |
| <http://127.0.0.1:8000/team> | **Lab team portal** (ground): every metric in detail, read from the link-delayed ground copy |

On the first run, `run.sh` creates a Python virtual environment, installs the Python packages and the npm packages, and builds the UI. Later runs start in about a second.

| Command | What it does |
|---|---|
| `./run.sh` | Set up and start (FastAPI serves the built React app) |
| `./run.sh test` | Run the pytest suite |
| `./run.sh dev` | Backend on :8000 plus the Vite dev server with hot reload on :5173 |
| `PORT=9000 HUB_SEED=7 ./run.sh` | Use a different port or seed |

Requirements: Python 3.11+ and Node 18+. If `node` isn't on your PATH, `run.sh` also looks in `~/.local/node/bin`.

### Windows

**Option A: `CrewHealthHub.exe` (no Python or Node needed).** Download it from the repo's **Releases** page, or from **Actions → Windows executable → latest run → Artifacts**, then double-click it.
- A console window opens and shows the address, and your browser opens the start page. If port 8000 is busy, it picks the next free port.
- Close the console window to stop the app.
- Windows SmartScreen may warn the first time because the file isn't code-signed. Click **More info → Run anyway**.
- Each start is a fresh simulation. The database lives in `%LOCALAPPDATA%\CrewHealthHub`.
- Options: `CrewHealthHub.exe --port 9000 --seed 7 --no-browser`

**Option B: from source.** With Python 3.11+ and Node 18+ installed, double-click `run.bat` (or run it in a terminal). `run.bat test` runs the tests, and `run.bat rebuild` rebuilds the UI.

**How the .exe is made.** PyInstaller bundles the backend, the built UI and the config into one file (`packaging/CrewHealthHub.spec`). A Windows `.exe` must be built on Windows, so there are two ways:
- the GitHub Actions workflow `.github/workflows/windows-exe.yml`, which builds it, runs the tests and a smoke test, and uploads it. Start it with **Run workflow**, or push a tag like `v1.1.0` to attach the `.exe` to a GitHub Release;
- `packaging\build_windows.bat` on any Windows PC, which writes `dist\CrewHealthHub.exe`.

### Android phone (APK)

**Install:** download `CrewHealthHub.apk` on the phone from the repo's **Releases** page (or **Actions → Android APK → latest run → Artifacts**), open it, and allow your browser or file manager to "install unknown apps" when Android asks.
- The whole app runs **on the phone**: the same simulator, both portals and both languages. No computer or internet is needed (only the live NASA OSDR list on *Data sources* uses the internet).
- The first start takes up to a minute while the simulator builds its history. Needs a 64-bit ARM phone with Android 7 or newer.
- If a newer APK won't install over an older one, uninstall the old app first.

**How the APK is made.** [Chaquopy](https://chaquo.com/chaquopy/) puts Python 3.12 inside the app. `android/app/src/main/python/android_main.py` starts the same FastAPI server on `127.0.0.1`, and a WebView (`MainActivity.java`) shows it. Chaquopy has no Android build of pydantic-core, so the phone uses FastAPI 0.110 with the pure-Python pydantic 1.x (`android/app/requirements.txt`); the GitHub workflow runs the full test suite with those packages before building. To build it yourself (JDK 17, Android SDK, Python 3.12): `cd frontend && npm run build`, then `./android/prepare.sh` and `gradle -p android :app:assembleDebug`.

Every start uses a fresh simulation with the default seed (42) and opens on mission day 30. The clock runs at 1 mission day per 60 s.

### Crew card sign-in (NFC)

The app opens on a card reader screen. On an Android phone with NFC turned on, hold a crew card to the back of the phone: the app reads it and opens that person's portal. Tapping a card on any other page switches to that person.
- **Which cards work:** any NFC sticker or card (NTAG213/215 are cheap and common). Write one **text record** on it with a free app such as *NFC Tools* (Write → Add a record → Text):

  | Card text | Opens |
  |---|---|
  | `ORBITAL-CREW-01` … `ORBITAL-CREW-05` | Astronaut 1 … 5 |
  | `MISSION-CTRL-99`, `TONOMETER-ADMIN-04` | Lab team |

- **Cards with no text** (for example a transit or hotel card) are read by their chip number. The app shows it, as in "This card is not on the crew list · Card UID:04A1B2C3…". Add that `UID:…` value to `frontend/src/lib/cards.ts` to accept the card.
- **No NFC:** on a PC, a browser or a phone without NFC, use the quiet *No card?* row (Astronaut 1–5, Lab team) or *Simulate a card tap*.
- **How it works:** Android WebView has no Web NFC, so `MainActivity.java` runs the phone's NFC reader (reader mode) while the app is open and passes each card to the page with `window.SHMS_onNfcTag(id)`; `frontend/src/lib/nfc.ts` and `cards.ts` decide who it is.
- A card ID says who is holding the device. It is not a password: cards can be copied. That is fine for a demo, not for real medical data.

---

## Two portals

**Astronaut portal (`/crew`)**: big text, big buttons, plain words, no statistics.

| Screen | What the crew member sees |
|---|---|
| **Today** | Overall status, the top alert with what to do, today's tasks with one confirm tap, energy burned so far, a mood check-in prompt, last night's sleep, the supplement score. After landing: today's readiness level. |
| **Exercise** | Today's plan with an energy estimate, then a **live workout**: heart rate and **calories burned** update every second. Summary afterwards. |
| **Energy** | Every activity of the day (sleep, meals, science, maintenance, exercise, spacewalk, family call…) on a timeline with the calories it burns, what is done/now/next, burned vs eaten for 7 days, body mass. |
| **Body** | Vitals now against "your normal", sleep for 14 nights, kidney health in one word, **medical checkups (LSAH)**: the next tests and the latest results, CO₂ and radiation. |
| **Food & water** | One-tap water and food logging, the supplement dose, yesterday against target. |
| **Mind** | Daily check-in (feeling, stress, tiredness, connection), a 10-tap **reaction test**, wellbeing score, tips. Shared only with the flight surgeon and psychologist. |
| **Return to Earth** | In flight: landing countdown, a personal prediction of balance on landing day and days to recover, pre-landing training progress, the plan. After landing: **what you may do today** (walk alone, stairs, shower standing, drive), a dizziness check, the balance recovery chart and safety tips. |

**Lab team portal (`/team`)**: for flight surgeons, lab staff and psychologists on the ground. Every page reads the **ground copy**, the data that has arrived through the store-and-forward link, so with a Mars delay it shows the mission as it was minutes ago.

| Screen | Detail |
|---|---|
| **Overview** | All crew cards (status, wellbeing, energy balance, reaction time or readiness), demo panel, ground link, protocols table, trends per metric, correlation heatmap, event log |
| **Alerts** | Every alert for the selected crew member with its reason, recommendations and source |
| **Vitals & sleep** | Each vital with EWMA, baseline band, z-score, slope and thresholds |
| **Exercise & energy** | Energy burned per activity per day vs intake, energy balance, body mass (SLAMMD), the day's activity table with METs, how energy is calculated, weekly minutes, strength and fitness trends, every session with kcal |
| **Urine lab** | Stone risk, bone-loss indicators, protocol response score, all urine markers |
| **Nutrition** | Last full day against plan, supplement adherence, trends |
| **Mental health** | Wellbeing index, check-in answers, reaction time and lapses, workload, private calls, rules triggered |
| **LSAH tests** | NASA's Lifetime Surveillance of Astronaut Health structure: the crew member's next annual exam with the MR089S items due for their age and sex, the LSAH tests during this mission (done / missed / planned), the four simulated LSAH results, and the full 50-category LSAH test catalog |
| **Vestibular** | Readiness level and its rule table, model landing effects, pre-landing training, measured recovery with an exponential fit, balance, tandem walk, dizziness and stand-test trends |
| **Environment · Devices · Data sources** | As before, plus the new devices and every new value |

---

## 3-minute demo script

| Time | Where | Do / say |
|---|---|---|
| 0:00 | **Start page** → **TR** | Show the language switch (server text such as alerts and tips switches too). Back to **EN**, then **Astronaut**. |
| 0:15 | **Today** (Astronaut 1) | Red status, *"Kidney-stone risk is high"* with its reason, today's tasks, **Energy today** (calories burned so far), the check-in prompt. |
| 0:35 | **Today** → *T2 / CEVIS* → **Start live** | Heart rate climbs and **kcal** count up live; raise speed/watts and watch kcal/min rise. **Finish & log**: minutes, kcal, heart rate. |
| 1:00 | **Energy** | The day as a timeline: each activity with the energy it burns, *NOW* marker, burned vs eaten. |
| 1:15 | **Mind** | Do the 4-question check-in and the reaction test. Switch to **Astronaut 3**: poor-sleep week → *"Slower reactions after poor sleep"*, advice to postpone critical tasks. |
| 1:35 | **Portals → Lab team** | Overview: all five crew. Astronaut 2 *"Workload is driving stress up"*, Astronaut 4 *"Isolation strain"*. Open **Mental health** and **Exercise & energy** for the detail. |
| 1:55 | **Lab team → Overview → Demo panel → R+1** | Fast-forward to the day after landing (a few seconds). **Vestibular**: Astronaut 2 (first flight) is at readiness 1, *"Post-flight vestibular dysfunction"*. |
| 2:20 | **Astronaut portal → Balance** (Astronaut 2) | What he may do today (✓ walk with a helper, ✕ stairs, ✕ drive), dizziness check, rehab task. Jump **R+3 / R+7**: levels rise as balance recovers; Astronaut 1 (second flight) recovers fastest. **Lab team → LSAH tests** (Astronaut 4): the post-flight DXA shows his larger hip bone loss. |
| 2:45 | Demo panel → **Mars** profile | The lab views lag behind the crew by the link delay. The astronaut's **Mind** screen now says live calls home are impossible and suggests a video message; over the next week *Private calls* falls and raises an alert. |
| 3:00 | **Data sources** | Every reference value with its source, the unverified list, live NASA OSDR studies. |

Other things to show: **Inject event** (*Spacewalk (EVA)* changes the day's activities and energy, *High workload*, *Isolation*, *Fever*, *CO2 spike*), **Devices → Simulate disconnect**, **Force link blackout**, a CSV import, and the Bluetooth heart-rate strap button in the live workout (Chrome/Edge over HTTPS or localhost). The kidney-stone → potassium citrate → response score flow from v1.0 is unchanged (Today → *Start & take dose*, then **+7 days**, then **Urine lab**).

---

## What's inside

```
config/reference.yaml   every value, threshold, rule, recommendation, protocol, energy cost, schedule,
                        behavioural-health and vestibular parameter, each with source + verified,
                        and Turkish text (`<key>_tr`) for everything people read
config/osdr_fallback.json   cached OSDR response used when the live API can't be reached
backend/launcher.py      desktop launcher (used by the Windows .exe): free port, opens the browser
packaging/              PyInstaller spec + Windows build script; .github/workflows/windows-exe.yml builds the .exe
backend/app/
  sim/model.py          coupled physiology model: exercise, intake, urine, vitals, sleep, energy per
                        activity, body mass, behavioural health, post-flight vestibular recovery
  sim/world.py          mission clock (preflight, in flight, after landing), tasks, protocols,
                        live workouts with energy, check-ins, snapshots, ground evaluation
  adapters/             one DeviceAdapter interface: read_day · live · status
                        ARED, T2, CEVIS, Bio-Monitor, Actiwatch, T-Mini, CO2, dosimeter, UWMS,
                        SLAMMD body mass, reaction test (PVT), balance clinic, manual, CSV
  engine/stats.py       EWMA (restarts after long data gaps), baseline mean/SD, z-score, slope, Pearson
  engine/rules.py       per-metric + cross-source + protocol rules → green/amber/red + reason (EN and TR),
                        rules can be limited to mission phases
  engine/response.py    protocol response score + exponential fit for days to target
  engine/vestibular.py  return-to-Earth readiness level + balance recovery fit
  link/groundlink.py    store-and-forward outbox: numbered packets, delay, blackout windows, acks
  services/osdr.py      NASA OSDR Biological Data API client with cache and fallback
  i18n.py               one language per request (X-Lang header), applied to every JSON response
  api/routes.py         REST + WebSocket; `?side=ground` serves the lab team from the ground copy
frontend/src/
  pages/crew/           astronaut portal          pages/team/   lab-team portal
  i18n/tr.ts            Turkish UI text (keyed by the English text)
  scripts/check-i18n.mjs  fails the build if a UI string has no Turkish entry
```

**Simulator.** 5 crew members, 10 preflight baseline days, a 180-day mission and **21 days after landing** (R+0 … R+20). The sources affect each other:
- Exercise raises heart rate, sweat loss, the water target and **energy burned**, and lowers stress.
- Low water lowers urine volume, which raises specific gravity and stone risk.
- Missing ARED sessions makes urine calcium rise faster.
- Protocols change later urine samples, scaled by adherence and a per-person response factor.
- **Energy:** each day follows a crew schedule (sleep, hygiene, meals, planning, science, maintenance, two exercise slots, free time). Every block costs MET × body mass × hours; exercise uses the machine settings (ARED load, T2 speed and harness load, CEVIS watts). Eaten minus burned changes **body mass** (7700 kcal per kg), measured on SLAMMD.
- **Behavioural health:** sleep debt, workload above 9 h, CO₂ and isolation raise stress and tiredness; exercise lowers stress; live family calls (weekly, impossible with a Mars delay) keep the crew member connected. Reaction time slows with sleep debt, CO₂ and tiredness. The crew member's own check-in and reaction test replace the simulated values for that day.
- **Return to Earth:** balance tests need gravity, so they run before launch (baseline) and after landing. The landing-day drop in balance score, tandem walk, dizziness and stand-test heart rate scales with mission length and personal susceptibility; pre-landing training (last 14 days) lowers it by up to 25 % and fitness lowers the stand-test rise. Everything fades with a personal time constant, a little faster with daily vestibular rehab.

**The crew.** Five fictional astronauts (launch 1 March 2027, landing 28 August 2027). Age, sex, birth month and earlier flights matter, because the LSAH annual-exam rules depend on them. Scripted events with the default seed:
- **Astronaut 1** (Commander, 45, 2nd flight): high stone risk; the fastest vestibular recovery.
- **Astronaut 2** (Pilot, 38, 1st flight): dehydration on days 26–32 and a high-workload week (27–33, overtime replaces free time and the family call); high susceptibility, so the slowest vestibular recovery.
- **Astronaut 3** (Flight Engineer, 42, 1st flight): poor-sleep week on days 27–33 (slower reaction times), a poor responder to potassium citrate from day 12, and she often skips the vitamin D tablet, so her blood vitamin D falls in flight.
- **Astronaut 4** (Mission Specialist, 51, 3rd flight): missed workouts on days 20–34 and 100–120 (bone-loss rule, the largest hip bone loss on the post-flight DXA) and an isolation week on days 24–33.
- **Astronaut 5** (Mission Specialist and crew medical officer, 36, 1st flight): two spacewalks (days 21 and 29); otherwise the healthy reference.

The same seed and the same actions always give the same data. Tasks you don't confirm are completed by the simulated crew at their usual adherence ("demo autopilot", which can be switched per crew in the Demo panel).

**Rules.** For each metric: an EWMA-smoothed value, a z-score against the personal preflight baseline, a 7-day slope, and an anomaly flag. Thresholds come from `config/reference.yaml`. Rules can be limited to mission phases (for example the weekly-exercise rule only applies before landing). The ten cross-source rules are:
- stone risk = supersaturation + urine volume
- bone loss = low ARED minutes + rising urine calcium (in flight)
- exercise dehydration = exercise + water + specific gravity
- fatigue = sleep + resting heart rate
- energy deficit = energy balance + falling body mass
- cognitive fatigue = sleep + slower reaction time
- isolation strain = feeling connected + mood
- workload stress = workload + stress
- post-flight vestibular dysfunction = balance score + dizziness (after landing)
- feeling faint when standing = stand-test heart-rate rise + dizziness (after landing)

Every alert shows its reason and a recommendation from the fixed list, in English or Turkish.

**Return readiness.** After landing, each test day sets a level from 0 (*assisted only*) to 4 (*ready for driving clearance*): the highest level whose balance (% vs baseline), tandem-walk and dizziness limits all hold. Each level unlocks activities (walk with a helper, walk alone indoors, stairs, shower standing, driving after the flight surgeon's clearance). Levels and limits are in the config.

**LSAH.** [Lifetime Surveillance of Astronaut Health](https://nlsp.nasa.gov/resources/lsah) is NASA's medical surveillance program for astronauts. Its real records are protected by the Privacy Act and HIPAA and are released only as grouped data or through an approved NASA data request (with ethics-board approval and about 13 months' lead time for de-identified data), so **no real astronaut values are used**. The app takes LSAH's structure from its public documents:
- the **test catalog**: all 50 LSAH data categories, with the mission phase each is collected in (before, in, after flight, yearly) and the NASA medical requirement (MRID) behind it, from *Medical Data Available for Request* (nlsp.nasa.gov);
- the **annual medical exam rules** from *MR089S Annual Medical Examinations* (JSC 28913): physical, labs, audiometry, resting ECG, optometry, dental and psychological evaluation every year in the birth month; graded exercise test at ages 30, 35, 40, every 2 years at 40–50 and yearly after 50; DXA and threshold visual fields every 3 years; PSA for men 40+; Pap smear yearly and mammography every 2 years at 40–50 and yearly after 50 for women; proctosigmoidoscopy and colonoscopy at set ages;
- four **LSAH-category tests simulated during the mission**: blood draws (serum vitamin D, hemoglobin) on L-9, days 30–175 and R+0/R+14; a graded exercise test on CEVIS (VO2peak) on L-7, every 30 days and R+5/R+15; and a hip DXA scan on L-8 and R+7. The categories and phases are LSAH's; the exact days and the value models are this demo's assumptions. In-flight bone loss grows with missed resistance exercise, VO2peak is protected by cardio, vitamin D in flight depends on food and the daily tablet (no sunlight), and hemoglobin dips ("space anemia") and recovers after landing.

**Response score.** For each target marker, `progress = 1 − |current − target| / |start − target|`, clipped to 0..1 and computed on EWMA values. The protocol score is the average over its markers. Days to target come from fitting `p(t) = p_max·(1 − e^(−t/τ))`. It measures how far urine markers have moved; it is **not** bioavailability. The same fit estimates balance recovery after landing.

**Ground link.** The ISS profile has a 0.5 s delay, Gateway 1.3 s, and Mars up to 22 min (adjustable). Each profile has periodic blackouts, and a blackout can also be forced. Delays run in **real time**, not on the fast mission clock, so the lag is visible. The whole lab-team portal reads only data that has arrived through the link.

**Languages.** Text the server produces (metric names and meanings, alerts and their reasons, recommendations, tasks, device names, the event log) is stored in English and Turkish and returned in the language of the request. The UI's own text uses a Turkish dictionary keyed by the English text; `npm run build` refuses to build if a string is missing from it.

**OSDR.** The app calls `https://visualization.osdr.nasa.gov/biodata/api/v2/query/datasets/` with `study.characteristics.organism=Homo sapiens` plus the study title and description columns (`format=json.records`), then tags the studies by topic. Responses are cached for 6 h in `data/osdr_cache.json`. If the live call fails, the app uses that cache, or `config/osdr_fallback.json`. Study titles stay in their original language.

**Tests.** `./run.sh test` runs the pytest suite (78 tests) covering:
- the simulator: seeding, coupling between sources, scripted events, the protocol flow, the live workout and link delay
- energy: machine-based exercise cost, the day's energy adding up, body mass, live workout kcal, EVA days
- behavioural health: Mars delay and live calls, the scripted mind states, check-in and reaction test values
- return to Earth: training and fitness effects, readiness levels, landing drop and recovery, post-flight rules and tasks
- the rules: thresholds, z-score, slope, anomaly, cross-source and protocol rules, and config validation
- the response score: formula, clipping and the exponential fit
- LSAH: the five-crew roster, the 50-category bilingual catalog, every MR089S annual-exam rule, tests only on their days, the crew stories in the LSAH results, and the LSAH API
- languages: localization, Turkish text for every metric/rule/recommendation, Turkish API responses
- API smoke tests, including the lab team's ground view lagging behind the crew with a Mars delay

---

## Reference values (verified)

These are the only values marked `verified: true`:

- Exercise ~2 h/day; ~600 min/week across T2, CEVIS and ARED (range 450–720); ARED peak load 272 kg; T2 peak speed 19.3 km/h; intake 2296 ± 449 kcal/day — *npj Microgravity (2020, 2023)*
- Crew sleep less in flight than before or after — *NASA wearable technology*
- In flight, urine calcium is up to ~50% higher, and volume, pH and citrate are lower. Stone risk is higher under 2 L/day of urine and lowest above 2.5 L/day — *ntrs.nasa.gov/citations/20000084164, /20000020539*
- Potassium citrate 20 mEq/day as two 10 mEq pills with the last meal raises citrate by about 130–140 mg/day and pH by 0.2–0.3. Calcium oxalate supersaturation above 2.0 means higher risk — *ntrs.nasa.gov/citations/20090019087*
- The LSAH test catalog (categories, mission phases, MRIDs) — *NLSP, LSAH: Medical Data Available for Request* — and the annual-exam schedule rules — *MR089S Annual Medical Examinations, JSC 28913*. These are structure only; no LSAH values are used.

## Values still marked unverified

Everything else in `config/reference.yaml` has `verified: false` and shows an **unverified** tag in the UI. The same list (in both languages) appears on the **Data sources** page. There are 104 items:

**Models and settings (12)**
- Simulation settings (seed, start day, clock speed, workout time scale ×10, 21 post-flight days)
- All physiology model coefficients (water→urine volume, sweat loss, calcium rise and post-flight recovery, citrate/pH flight drop size, protocol onset, water target, heart-rate response, post-flight heart-rate rise, how much less crew sleep in flight, radiation dose rates, CO2 levels)
- The daily split of the exercise prescription (ARED 45 min + cardio 40 min, 60 min reconditioning after landing). The 600 min/week target itself is verified.
- CEVIS maximum power (350 W)
- Food catalogue nutrient values
- **Energy costs:** MET values per activity, the ARED MET range, the ACSM running equation with harness scaling, CEVIS gross efficiency, 7700 kcal per kg of body mass, how intake scales with body mass
- **Crew day schedule** (activity times, EVA window, weekly family call, live-call delay limit)
- **Behavioural-health model** (stress, tiredness, connection and reaction-time coefficients)
- **Post-flight vestibular model** (landing drop in balance, tandem walk, dizziness and stand-test heart rate; mission-length scaling; 25 % training benefit; recovery time constants)
- **Readiness levels** and the activities each level allows
- **LSAH test days** during the mission and **how the LSAH test values change** (bone loss per month, VO2peak, vitamin D, hemoglobin)
- **The CaOx supersaturation estimate.** It is a simplified formula, not the EQUIL2 program. The 2.0 threshold is verified; the way the number is computed is not.

**Thresholds (54)**
- Sleep < 6.0 h amber, < 5.0 h red; sleep efficiency < 80%
- Resting heart rate z > 2 amber, > 3 red; breathing > 20/min; BP > 135/88
- SpO₂ < 95% amber, < 92% red; core temperature > 37.6 °C amber, > 38.0 °C red
- CO₂ > 3.0 mmHg amber, > 4.0 red; daily radiation > 5 mSv; cumulative > 250 mSv
- Urine calcium > +70% red; citrate < 450 mg/day; oxalate > 45 mg/day; uric acid > 800 mg/day; pH < 5.5; specific gravity > 1.025 amber, > 1.030 red; stone risk > 1.8 amber
- Water intake < 2.5 L; protein < 70 g; sodium > 4500 mg
- Energy balance < −600 kcal; body mass −5 % vs baseline
- How I feel < 2.5; stress > 3.5 amber, > 4.3 red; tiredness > 3.5; feeling connected < 2.5; wellbeing < 50; reaction time z > 2 amber, > 3 red; attention lapses > 3; workload > 10.5 h; private calls < 30 min/week (in flight)
- Hip bone density −5 % amber, −7.5 % red; VO2peak −10 % amber, −20 % red; serum vitamin D < 30 ng/mL amber, < 20 red; hemoglobin −10 %
- Balance score −10 % amber, −25 % red; tandem walk < 7 amber, < 5 red; dizziness > 3 amber, > 6 red; stand-test heart-rate rise > 30 bpm

**Rules**
- Cross-source rules (9): bone loss, exercise dehydration, fatigue, energy deficit, cognitive fatigue, isolation strain, workload stress, post-flight vestibular dysfunction, feeling faint when standing. The stone-risk rule is verified.
- Protocol rule: response score below 0.35 after 14 days means "not working well".

**Recommendations (20)**
- Resume ARED, reduce intensity, protect sleep, core-temperature check, check CO₂, radiation shelter, lower salt, flag for the flight surgeon, talk to the crew psychologist, plan a family call or video message, take a break, postpone safety-critical tasks, reduce workload, fall precautions, no driving until cleared, vestibular rehab, move the head slowly, stand up in stages, pre-landing training, take the daily vitamin D tablet.

**Targets and link**
- Nutrition targets: protein 90 g, sodium max 3500 mg, calcium 1000 mg, vitamin D 800 IU
- Link profiles: the ISS 0.5 s and Gateway 1.3 s delays, the Mars 22 min maximum, and all blackout windows. The delays come from the project brief, not the reference list.

To check a value, update its entry in `config/reference.yaml` (value, `source`, `verified: true`). The UI tag and this list follow the config automatically. The config loader refuses to start if any reference, rule, recommendation, target or model section is missing `source` or `verified`.

---

*Decision-support demo with simulated data. Not a medical device and not for clinical use.*
