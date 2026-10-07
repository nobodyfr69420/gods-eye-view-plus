# ME — track yourself

The **ME** tab of the OVERLAYS panel (press **Shift+M**) puts _you_ on the globe, using every
source a personal machine can reach. Everything is stored in `.gev-cache/me/fixes.jsonl` on the
machine running the server and served only to that machine (or to a device holding your ingest
token). Nothing is uploaded anywhere. **IP LOCATE** is the one action that asks an outside service
(`ipwho.is`), and only when you press it.

## Sources

| Source                        | How                                                  | Accuracy                                                                                  | Notes                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This browser**              | **▶ START TRACKING** (continuous) or **LOCATE ONCE** | GPS-grade on phones/laptops with GPS (±5–20 m); Wi-Fi positioning on desktops (±20–150 m) | Uses the browser Geolocation API with high accuracy. Tracking resumes on reload and keeps the screen awake while visible. Browsers allow it on `localhost` or HTTPS only.                       |
| **Your phone, 24/7**          | A tracking app posts to this server (setup below)    | GPS                                                                                       | Works with the screen off. Battery and speed come along.                                                                                                                                        |
| **IP estimate**               | **IP LOCATE**                                        | City-level (~5–50 km), sometimes your ISP's hub                                           | Shown with a 25 km uncertainty circle.                                                                                                                                                          |
| **Google Maps Timeline**      | Drop the export on the ME tab                        | As recorded                                                                               | On the phone: _Settings → Location → Location services → Timeline → Export Timeline data_ (`Timeline.json`). Older Takeout `Records.json` and _Semantic Location History_ month files work too. |
| **GPX / KML / GeoJSON / CSV** | Drop the files                                       | As recorded                                                                               | Strava, Garmin, Komoot, Google Earth, GPSLogger exports… CSV needs `lat`/`lon` (or `latitude`/`longitude`) columns; `time` is optional.                                                         |
| **Photos**                    | Drop JPEGs                                           | Camera GPS                                                                                | Reads the EXIF GPS position and time; the photo itself is not stored.                                                                                                                           |

## Track your phone

1. Make the server reachable from your phone:
   - **Same Wi-Fi:** add `HOST=0.0.0.0` to `.env` and restart `npm run dev`.
   - **Anywhere:** install [Tailscale](https://tailscale.com) on the PC and the phone and use the PC's
     Tailscale IP (`100.x.y.z`). No ports are opened to the internet.
2. Open **ME → SHOW PHONE SETUP**. It shows your token and copy-ready URLs for this PC's address.
   `npm run keys` pins the token in `.env` as `ME_INGEST_TOKEN`. Without it, a per-machine token is kept
   in `.gev-cache/me/ingest-token`.
3. Configure one app:

| App                              | Settings                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OwnTracks** (iOS/Android)      | Mode **HTTP**, URL `http://<pc>:4173/api/me/owntracks`, authentication on, username = a device name, password = the token                                                         |
| **Overland** (iOS/Android)       | Receiver endpoint `http://<pc>:4173/api/me/overland?token=<token>`                                                                                                                |
| **GPSLogger** (Android)          | Log to custom URL: `http://<pc>:4173/api/me/osmand?token=<token>&id=phone&lat=%LAT&lon=%LON&timestamp=%TIMESTAMP&altitude=%ALT&accuracy=%ACC&spd_ms=%SPD&bearing=%DIR&batt=%BATT` |
| **Traccar Client** (iOS/Android) | Server URL `http://<pc>:4173/api/me/osmand?token=<token>`, device identifier `phone`                                                                                              |

Several devices (phone, tablet, car tracker) each get their own color, trail and row under **MY DEVICES**.

## What you see

- **Overlays** (category _Me & My Devices_ in the LIBRARY, or the chips in the ME tab): **My Position**
  (latest fix per device), **My Position Accuracy** (uncertainty circles), **My Trail** (path for the
  chosen range, split where tracking paused), **My Places** (where you spent 10+ minutes, sized by
  hours) and **My Photo Locations**. Click any of them for details.
- **LIVE**: latitude/longitude, MGRS, Maidenhead, accuracy class, altitude, speed (km/h and mph),
  heading, battery, sun elevation and source. **FLY TO ME** jumps there; **FOLLOW** keeps the camera
  over you as fixes arrive.
- **MY STATS** for Today / 24 h / 7 days / 30 days / 1 year / All: distance, moving time, max and
  average moving speed, metres climbed, days with data and your top places by hours. GPS jitter
  while standing still and teleport-like jumps are not counted as movement.
- **Export** the chosen range as GPX, GeoJSON or CSV.

## Privacy and security

- **FORGET ALL MY LOCATION DATA** (press twice) deletes the store; **FORGET** on a device row
  deletes that device's history.
- Ingest endpoints need the token: Basic-auth password, `Authorization: Bearer`, `X-Me-Token` or
  `?token=`. Cross-site browser requests are refused.
- Read endpoints (`/state`, `/track`, `/setup`, `/ip`, `/import`, `/forget`) answer only the machine
  running the server — loopback socket, local Host header, no proxy headers, not while sharing — or a
  caller presenting the token.
- This feature is for tracking **yourself** and your own devices. Do not install tracking apps on
  someone else's phone.

## Endpoints

| Method   | Path                                                   | Who                                 |
| -------- | ------------------------------------------------------ | ----------------------------------- |
| POST     | `/api/me/owntracks`                                    | token                               |
| GET/POST | `/api/me/osmand`                                       | token                               |
| POST     | `/api/me/overland`                                     | token                               |
| POST     | `/api/me/browser`                                      | same-origin page                    |
| GET      | `/api/me/state`, `/api/me/track?since=&device=&limit=` | local or token                      |
| GET      | `/api/me/setup`, `/api/me/ip`                          | local or token                      |
| POST     | `/api/me/import`, `/api/me/forget`                     | local (JSON, exact Origin) or token |
