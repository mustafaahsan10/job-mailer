# Job Mailer

Turn a LinkedIn job post into a tailored application email in a couple of taps, sent from your own
Gmail with the right CV attached, for **$0/month**.

Share a job post (or a screenshot of it) to the Job Mailer app on Android. Gemini reads the post,
finds the application email, and drafts a short, specific email from your profile. You review and
edit it, tap **Send**, and it goes out from your Gmail with your CV attached. Every sent email is
logged to a private Google Sheet.

Nothing is ever sent without you reviewing it first.

## How it works

```
Android share sheet / screenshot
        │
        ▼
PWA on GitHub Pages  (static, no secrets)
  - share_target receives the post
  - service worker hands it to the app
  - screenshots compressed to ~1600px JPEG
        │  POST (text/plain, no CORS preflight) + access token
        ▼
Google Apps Script web app  (runs as you)
  - draft: Gemini Flash with a JSON schema reads the post + your profile
  - send:  GmailApp sends with the chosen CV from Drive
  - logs:  Google Sheet (company, role, HR, CV, status, follow-up date)
```

| Part | Where it runs | Cost |
|---|---|---|
| `pwa/` | GitHub Pages | free |
| `apps-script/Code.gs` | Google Apps Script | free |
| AI drafting | Gemini API free tier (Google AI Studio key) | free |
| Email + logging | Your Gmail, Drive and Sheets | free |

## Features

- **Share to draft:** share a post or screenshot and a draft appears.
- **Grounded emails:** 90–150 words, and it only claims experience that is in your profile.
- **Picks the email address from the post** and never invents one. If none is found, it says so.
- **Picks the best CV** when you keep more than one (for example "AI / ML" and "General").
- **Warnings** for posts that look like scams, ask for things the email doesn't cover (salary,
  notice period), or where you have already emailed that address.
- **Duplicate check** before sending to an address you have emailed before.
- **Resilient AI calls:** retries with backoff, then falls back to Gemini Flash-Lite when Flash is busy.
- **Private by design:** the public site holds no secrets. Your backend URL and access token live
  only on your phone, and API keys live in Apps Script properties.

## Project layout

```
pwa/
  manifest.json   share_target (POST multipart: title, text, url, image)
  sw.js           catches the shared POST, stores it, redirects to the app
  index.html      settings, input, draft review and sent screens
  app.js          talks to the backend, compresses screenshots
apps-script/
  Code.gs         doPost actions: config, draft, send; token check on every request
profile-template.md   fill in and upload to Drive; the AI writes from this
.github/workflows/pages.yml   deploys pwa/ to GitHub Pages
```

## Set up your own copy

You need a Google account and an Android phone with Chrome.

### 1. Google Drive
1. Copy `profile-template.md`, fill it in with your real details, and upload it to Drive.
   Keep it factual, because the AI only claims what is written there.
2. Upload your CV PDF(s).
3. Create a blank Google Sheet for the log.
4. Note the ID of each file: the long string between `/d/` and `/` in its link.

### 2. Gemini API key
Create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### 3. Apps Script backend
1. Open your Sheet and choose **Extensions → Apps Script**, then paste in `apps-script/Code.gs`.
2. In **Project Settings → Script Properties**, add:

   | Property | Value |
   |---|---|
   | `GEMINI_API_KEY` | your key |
   | `PROFILE_FILE_ID` | Drive ID of your profile |
   | `CV_FILES` | JSON of name → Drive ID, e.g. `{"AI / ML":"<id>","General":"<id>"}` |
   | `SHEET_ID` | ID of the log Sheet |
   | `SENDER_NAME` | *(optional)* name shown in the From field |
   | `GEMINI_MODEL` | *(optional)* defaults to `gemini-flash-latest` |

3. Run `generateToken` and copy the token from the log.
4. Run `checkSetup` and approve the permissions. Google warns that the app is unverified, because
   you wrote it: choose **Advanced → Go to … → Allow**. Every line in the log should pass.
5. Choose **Deploy → New deployment → Web app**, with **Execute as: Me** and
   **Who has access: Anyone**. Copy the `/exec` URL. The access token keeps everyone else out.
   To update the code later, use **Manage deployments → Edit → New version** so the URL stays
   the same.

### 4. The app
1. Fork this repo and enable **Settings → Pages → Source: GitHub Actions**.
   The workflow publishes `pwa/`.
2. On your phone, open the Pages URL in **Chrome**, tap **⋮ → Install app** (not "Create shortcut"),
   then enter your `/exec` URL and token in Settings.
3. Test with a fake post that lists your own email address.

## Known issue: shared images arrive empty on Chrome 153 (Android)

A Chrome 153 regression strips images shared from gallery apps before they reach any web app
([squoosh#1503](https://github.com/GoogleChromeLabs/squoosh/issues/1503)). The share opens Job
Mailer but without the screenshot. Job Mailer detects this and tells you. Tap **Choose file**, pick
the screenshot, and drafting starts right away. Sharing works again once Chrome ships a fix.

Tip: LinkedIn's own Share button usually sends only a link, which the AI can't open. Screenshots,
or pasting the post text, work best.

## Ideas

- A daily trigger that scans Gmail for replies from logged addresses and updates the Status column.
- A follow-up reminder, or a one-tap follow-up email, after 7 days.
