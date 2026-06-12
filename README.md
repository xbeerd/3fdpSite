# 3FDP Team Site

Mobile-first team site for 3 Finger Death Punch.

## Sections

- Blog / notes home screen
- Bowling calendar
- Sub request workflow
- Biggest Loser contest
- Admin setup

## Netlify

This project is configured for Netlify.

- Static site: `public`
- Functions: `netlify/functions`
- Config: `netlify.toml`
- API redirect: `/api/*` -> `/.netlify/functions/api/*`

## Local Run

The old local Node server is still present for quick local testing, but the hosted version uses Netlify Functions.

```powershell
node server.js
```

For Netlify-style local testing, install Netlify CLI and run:

```powershell
npx netlify dev
```

## First Admin Setup

On the hosted Netlify version, the first registered account becomes admin.

For better protection, set a Netlify environment variable named `ADMIN_SETUP_CODE`. The first admin registration must enter that code.

## Admin Features

- Bowling start time and practice time
- Biggest Loser contest dates
- CSV schedule upload
- Account creation
- Password reset
- User deletion

## Push Notifications

Sub request push alerts use standard Web Push. Set these Netlify environment variables before deploying push alerts:

```text
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

`VAPID_SUBJECT` should be a contact URI such as `mailto:you@example.com`.

## Schedule CSV

Supported headers:

```text
date,lane,opponent,startTime,practiceTime
```

Example:

```text
date,lane,opponent,startTime,practiceTime
2026-09-03,12,Pin Crushers,18:30,18:15
```

## Calendar Downloads

Users can download:

- Individual bowling events as `.ics`
- The full season schedule as `.ics`

## Sub Requests

Users can request a sub from a calendar event. Other users can respond:

- I can sub
- I can't sub

The home screen summarizes open sub requests.

## Hosting Notes

Netlify can host the app for free-tier usage, but production data should live in a persistent service. This version uses Netlify Blobs when running on Netlify and falls back to local `data.json` only for development.
