# Job Mailer — project context

## What this is
A personal tool for Android: share a LinkedIn job post (text or screenshot) to an installed PWA,
Gemini drafts a tailored application email from the user's profile, the user reviews/edits it,
then it is sent from their own Gmail with the right CV attached and logged to a Google Sheet.

## Decisions already made
- Goal: as free as possible ($0/month).
- Architecture: PWA on GitHub Pages (static, no secrets) + Google Apps Script web app backend
  + Gemini Flash (free tier, AI Studio key). Chosen over Render/FastAPI (cold starts, Gmail OAuth
  hassle), Telegram bot, HTTP Shortcuts + n8n, and a native app.
- Always keep a human review step before sending. Never auto-send.
- Log every sent email to Google Sheets (company, role, HR name/email, CV, status, follow-up date).
  Sheet stays private.

## Files
- pwa/manifest.json  share_target (POST multipart: title, text, url, image)
- pwa/sw.js          catches the shared POST, stores it in Cache Storage, redirects to index.html?shared=1
- pwa/index.html     settings, input, draft review ("letter" layout), sent screens
- pwa/app.js         calls backend with Content-Type text/plain (avoids CORS preflight);
                     compresses screenshots to ~1600px JPEG before upload
- apps-script/Code.gs  doPost actions: config, draft, send. Token check on every request.
                     Gemini JSON-schema output, duplicate-email check, Sheet logging.
- profile-template.md  the user's profile, stored in Drive and read by the backend
- .github/workflows/pages.yml  deploys pwa/ to GitHub Pages on push (public repo mustafaahsan10/job-mailer)
- .env, profile.md   local only, gitignored (real keys, token, personal details). Never commit.

## Script Properties
GEMINI_API_KEY, ACCESS_TOKEN (from generateToken()), PROFILE_FILE_ID, CV_FILES (JSON name->Drive ID),
SHEET_ID, optional SENDER_NAME, optional GEMINI_MODEL (default gemini-flash-latest).

## Ideas not built yet
- Daily Apps Script trigger that scans Gmail for replies from logged addresses and updates Status.
- Follow-up reminder / one-tap follow-up email after 7 days.
