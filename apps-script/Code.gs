/**
 * Job Mailer backend (Google Apps Script)
 *
 * Script Properties (Project Settings -> Script Properties):
 *   GEMINI_API_KEY   your key from Google AI Studio
 *   ACCESS_TOKEN     created by running generateToken() once
 *   PROFILE_FILE_ID  Drive ID of your profile (Google Doc or .txt/.md)
 *   CV_FILES         JSON, e.g. {"AI / ML":"<fileId>","General":"<fileId>"}
 *   SHEET_ID         ID of the Google Sheet used as the log
 *   SENDER_NAME      (optional) name shown in the From field
 *   GEMINI_MODEL     (optional) defaults to gemini-flash-latest
 */

const SHEET_NAME = 'Applications';
const HEADERS = ['Date sent', 'Company', 'Role', 'HR name', 'HR email', 'Post',
  'CV used', 'Subject', 'Email body', 'Status', 'Follow-up date', 'Notes'];
const FOLLOW_UP_DAYS = 7;
const FALLBACK_MODEL = 'gemini-flash-lite-latest';

// ---------- Web app entry point ----------

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    if (!req.token || req.token !== props.getProperty('ACCESS_TOKEN')) {
      return json_({ ok: false, error: 'Invalid access token. Check it in the app settings.' });
    }
    switch (req.action) {
      case 'config': return json_({ ok: true, cvs: Object.keys(getCvFiles_()) });
      case 'draft':  return json_(draft_(req));
      case 'send':   return json_(send_(req));
      default:       return json_({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, message: 'Job Mailer backend is running.' });
}

// ---------- Draft ----------

function draft_(req) {
  if (!req.text && !req.image) {
    return { ok: false, error: 'Nothing to read. Share a post or screenshot, or paste the post text.' };
  }
  const cvNames = Object.keys(getCvFiles_());
  const profile = readProfile_();

  const instructions = [
    'You help a job seeker reply to job posts found on LinkedIn.',
    'Read the job post (text and/or screenshot) and the candidate profile, then return JSON only.',
    '',
    'Rules:',
    '- email: the application email address written in the post. If none is clearly visible, return null. Never guess or invent one.',
    '- hr_name: the recruiter or poster name if visible, else null.',
    '- company and role: from the post; null if unknown.',
    '- cv_choice: exactly one of: ' + JSON.stringify(cvNames) + '. Pick the best fit for the role.',
    '- subject: follow any subject format the post asks for; otherwise "Application for <role> - <candidate name>".',
    '- paragraphs: the email body as separate plain-text items, 90-150 words in total, no markdown.',
    '  Item 1 is only the greeting: the HR person by name if known, otherwise "Dear Hiring Team,".',
    '  Then 2-3 short paragraphs: mention the role, connect 2-3 of the candidate\'s real skills or projects',
    '  to the post\'s requirements, and say the CV is attached. Last item is only the sign-off, e.g. "Best regards,".',
    '  Only claim experience that is in the profile. No buzzwords, no exaggeration.',
    '- signature: one item per line: the candidate\'s full name, then phone, email and LinkedIn from the profile.',
    '- warnings: short notes for anything the candidate should check, e.g. no email found,',
    '  post asks for things the email does not cover (salary expectations, notice period),',
    '  role seems a poor fit, or the post looks like a scam (asks for payment, personal documents).',
    req.extra ? '- Extra instruction from the candidate for this draft: ' + req.extra : '',
    '',
    'CANDIDATE PROFILE:',
    profile,
    '',
    'JOB POST TEXT (may be empty or just a link if a screenshot is provided):',
    req.text || '(none)'
  ].join('\n');

  const parts = [{ text: instructions }];
  if (req.image) {
    parts.push({ inline_data: { mime_type: req.imageType || 'image/jpeg', data: req.image } });
  }

  const result = callGemini_(parts);
  // Paragraphs come back as a list so line breaks survive regardless of how the model formats text.
  result.body = (result.paragraphs || []).join('\n\n') + '\n' + (result.signature || []).join('\n');
  delete result.paragraphs;
  delete result.signature;
  if (result.email && !isEmail_(result.email)) {
    result.warnings = (result.warnings || []).concat('The detected email looks invalid: ' + result.email);
    result.email = null;
  }
  if (result.email) {
    const prev = findPrevious_(result.email);
    if (prev) result.warnings = (result.warnings || []).concat('You already emailed this address on ' + prev + '.');
  }
  return { ok: true, draft: result };
}

function callGemini_(parts) {
  const props = PropertiesService.getScriptProperties();
  const models = [props.getProperty('GEMINI_MODEL') || 'gemini-flash-latest', FALLBACK_MODEL];
  const payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          email:            { type: 'STRING', nullable: true },
          hr_name:          { type: 'STRING', nullable: true },
          company:          { type: 'STRING', nullable: true },
          role:             { type: 'STRING', nullable: true },
          key_requirements: { type: 'ARRAY', items: { type: 'STRING' } },
          cv_choice:        { type: 'STRING' },
          subject:          { type: 'STRING' },
          paragraphs:       { type: 'ARRAY', items: { type: 'STRING' } },
          signature:        { type: 'ARRAY', items: { type: 'STRING' } },
          warnings:         { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['email', 'cv_choice', 'subject', 'paragraphs', 'signature', 'warnings']
      }
    }
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': props.getProperty('GEMINI_API_KEY') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Busy (503) or rate-limited (429): retry with backoff, then fall back to the lighter model.
  let res, code;
  for (const model of models) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) Utilities.sleep(2000 * attempt);
      res = UrlFetchApp.fetch(url, options);
      code = res.getResponseCode();
      if (code !== 429 && code < 500) break;
    }
    if (code !== 429 && code < 500) break;
  }
  if (code === 429) throw new Error('AI rate limit reached. Try again in a minute.');
  if (code >= 500) throw new Error('Gemini is overloaded right now. Try again in a minute.');
  if (code !== 200) throw new Error('AI request failed (' + code + '): ' + res.getContentText().slice(0, 300));

  const data = JSON.parse(res.getContentText());
  const text = data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('AI returned no draft. Try Regenerate.');
  return JSON.parse(text);
}

// ---------- Send ----------

function send_(req) {
  if (!isEmail_(req.to)) return { ok: false, error: 'Enter a valid recipient email.' };
  if (!req.subject || !req.body) return { ok: false, error: 'Subject and body are required.' };

  const prev = findPrevious_(req.to);
  if (prev && !req.force) return { ok: false, duplicate: true, previous: prev };

  const cvFiles = getCvFiles_();
  const cvId = cvFiles[req.cv];
  if (!cvId) return { ok: false, error: 'Unknown CV: ' + req.cv };
  const cv = DriveApp.getFileById(cvId).getBlob();

  const opts = { attachments: [cv] };
  const senderName = PropertiesService.getScriptProperties().getProperty('SENDER_NAME');
  if (senderName) opts.name = senderName;
  GmailApp.sendEmail(req.to, req.subject, req.body, opts);

  const now = new Date();
  const followUp = new Date(now.getTime() + FOLLOW_UP_DAYS * 86400000);
  getSheet_().appendRow([now, req.company || '', req.role || '', req.hrName || '', req.to,
    (req.post || '').slice(0, 5000), req.cv, req.subject, req.body, 'Sent', followUp, '']);

  return { ok: true, remaining: MailApp.getRemainingDailyQuota() };
}

// ---------- Helpers ----------

function readProfile_() {
  const id = PropertiesService.getScriptProperties().getProperty('PROFILE_FILE_ID');
  if (!id) throw new Error('PROFILE_FILE_ID is not set.');
  const file = DriveApp.getFileById(id);
  if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(id).getBody().getText();
  }
  return file.getBlob().getDataAsString();
}

function getCvFiles_() {
  const raw = PropertiesService.getScriptProperties().getProperty('CV_FILES');
  if (!raw) throw new Error('CV_FILES is not set.');
  return JSON.parse(raw);
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function findPrevious_(email) {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const rows = sheet.getRange(2, 1, last - 1, 5).getValues();
  const target = String(email).trim().toLowerCase();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][4]).trim().toLowerCase() === target) {
      return Utilities.formatDate(new Date(rows[i][0]), Session.getScriptTimeZone(), 'd MMM yyyy');
    }
  }
  return null;
}

function isEmail_(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Run these once from the editor ----------

/** Creates a random access token, saves it, and prints it. Copy it into the app. */
function generateToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('ACCESS_TOKEN', token);
  Logger.log('Your access token: ' + token);
}

/** Grants permissions and checks that every setting works. Read the log after running. */
function checkSetup() {
  const props = PropertiesService.getScriptProperties();
  ['GEMINI_API_KEY', 'ACCESS_TOKEN', 'PROFILE_FILE_ID', 'CV_FILES', 'SHEET_ID'].forEach(function (k) {
    Logger.log(k + ': ' + (props.getProperty(k) ? 'set' : 'MISSING'));
  });
  Logger.log('Profile length: ' + readProfile_().length + ' characters');
  const cvs = getCvFiles_();
  Object.keys(cvs).forEach(function (name) {
    Logger.log('CV "' + name + '": ' + DriveApp.getFileById(cvs[name]).getName());
  });
  Logger.log('Sheet: ' + getSheet_().getParent().getName());
  Logger.log('Emails you can still send today: ' + MailApp.getRemainingDailyQuota());
  if (false) GmailApp.sendEmail('', '', ''); // makes Apps Script request Gmail send permission
  const test = callGemini_([{ text: 'Return JSON with email null, cv_choice "test", subject "ok", paragraphs ["ok"], signature ["ok"], warnings [].' }]);
  Logger.log('Gemini test: ' + JSON.stringify(test));
}
