# Google Form Registration

This connects a regular Google Form to Firestore through the response Google Sheet.

No Firebase Function URL is needed for this version. Google Apps Script writes to Firestore using your Firebase service account JSON key.

## Important

The service account JSON file is a private key.

- Do not paste it into chat.
- Do not commit it to GitHub.
- Do not put it in the React app.
- Store it only inside Google Apps Script project properties.

## Form Fields

Use these exact question names in Google Forms:

- `Full name`
- `Phone number`
- `Group ID`
- `Instagram`

Exact spelling matters.

## Add The Script

Open the Google Sheet connected to your Google Form:

1. `Extensions` -> `Apps Script`
2. Paste the contents of `google-form-registration.gs`
3. Save

## Add The Service Account JSON

In Apps Script:

1. Click `Project Settings`
2. Find `Script properties`
3. Click `Add script property`
4. Property name:

```txt
SERVICE_ACCOUNT_JSON
```

5. Property value: paste the entire contents of your downloaded Firebase service account JSON file.

The value should start with:

```json
{
  "type": "service_account",
  "project_id": "dance-power-cef6d",
```

and include the private key.

## Add The Trigger

In Apps Script:

1. Click `Triggers`
2. Click `Add Trigger`
3. Choose:

```txt
Function: onFormSubmit
Event source: From spreadsheet
Event type: On form submit
```

4. Save and approve Google permissions.

## Validation

- `Full name` is required.
- Cyrillic letters are rejected.
- Name must include at least two words.
- Name casing is normalized, for example `diana OSYKA` becomes `Diana Osyka`.
- `Phone number` is required.
- Slovak phone numbers are normalized to `+421 XXX XXX XXX`.
- `0901234567`, `421901234567`, and `+421901234567` become `+421 901 234 567`.
- `Group ID` is optional. If present it is saved in `groups`.
- `Instagram` is optional. Links and usernames are normalized to `@username`.
- Duplicate phone numbers are rejected.

## Emails

Emails go to `diana.osyka@outlook.com` for both success and failure.

## Test

Submit the real Google Form once.

If successful:

- A new document appears in Firestore `students`.
- You receive a success email.

If failed:

- No student is created.
- You receive an error email with the reason.
