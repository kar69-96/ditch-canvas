# Email Service Tests

This document describes the email notification tests for DitchCanvas.

## Overview

DitchCanvas uses EmailJS for two email functions:

1. **Feedback Modal** - Client-side emails from users submitting feedback
2. **Admin Notifications** - Server-side emails when new users sign up

## Test File Location

```
tests/backend/unit/services/email.test.js
```

## Running the Tests

```bash
# Run all email tests
npm run test:backend:unit -- --grep "Email Service"

# Run all backend unit tests
npm run test:backend:unit
```

## Test Cases

### Admin Notification Tests (`sendAdminNotification`)

| Test                                  | Description                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Send with all fields                  | Verifies email sends with user_name, user_email, school, invite_code, signup_time |
| Missing invite code                   | Confirms invite_code defaults to "N/A" when not provided                          |
| No private key or missing EmailJS env | Skips sending and returns `{ success: false, reason: "not_configured" }`          |
| API errors                            | Handles EmailJS errors gracefully without throwing                                |
| 403 forbidden                         | Handles disabled non-browser API error                                            |
| Missing service ID                    | Skips when `EMAILJS_SERVICE_ID` not set                                           |
| Missing admin template                | Skips when `EMAILJS_ADMIN_TEMPLATE_ID` not set                                    |
| Signup time format                    | Includes Mountain timezone formatted timestamp                                    |
| Auth options                          | Passes correct publicKey and privateKey to EmailJS                                |

### Feedback Modal Configuration Tests

Documents the expected configuration for the client-side feedback modal (set at build time via Vite):

| Config             | Value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| Service ID         | `VITE_EMAILJS_SERVICE_ID`                                               |
| Template ID        | `VITE_EMAILJS_TEMPLATE_ID`                                              |
| Public Key         | `VITE_EMAILJS_PUBLIC_KEY`                                               |
| Template Variables | `from_name`, `from_email`, `message`, `image_data`, `favorite_features` |

### Admin Notification Configuration Tests

Documents the expected configuration for server-side admin notifications:

| Config             | Value                                                             |
| ------------------ | ----------------------------------------------------------------- |
| Service ID         | `EMAILJS_SERVICE_ID` (required to send)                           |
| Template ID        | `EMAILJS_ADMIN_TEMPLATE_ID` (required to send)                    |
| Public Key         | `EMAILJS_PUBLIC_KEY` (required to send)                           |
| Private Key        | `EMAILJS_PRIVATE_KEY` (required to send)                          |
| Template Variables | `user_name`, `user_email`, `school`, `invite_code`, `signup_time` |

## Environment Variables

| Variable                    | Required to send | Default | Description                         |
| --------------------------- | ---------------- | ------- | ----------------------------------- |
| `EMAILJS_PRIVATE_KEY`       | Yes              | -       | Private key for server-side EmailJS |
| `EMAILJS_SERVICE_ID`        | Yes              | -       | EmailJS service ID                  |
| `EMAILJS_PUBLIC_KEY`        | Yes              | -       | EmailJS public key                  |
| `EMAILJS_ADMIN_TEMPLATE_ID` | Yes              | -       | Template for admin notifications    |

Client feedback form additionally requires `VITE_EMAILJS_SERVICE_ID`, `VITE_EMAILJS_TEMPLATE_ID`, and `VITE_EMAILJS_PUBLIC_KEY` in the frontend env.

## Manual Testing

To send a test admin notification email:

```bash
node -e "
require('dotenv').config();
const { sendAdminNotification } = require('./src/services/email');

sendAdminNotification({
  userEmail: 'test@colorado.edu',
  userName: 'Test User',
  school: 'University of Colorado - Boulder',
  inviteCode: 'TEST123'
}).then(console.log);
"
```

## EmailJS Dashboard Setup

1. **Enable non-browser API**: Account > Allow EmailJS API for non-browser applications
2. **Admin template** (create in EmailJS; set `EMAILJS_ADMIN_TEMPLATE_ID` to its ID):
   - Subject: `NEW USER: {{user_name}}`
   - To: Your admin email
   - Variables: `{{user_name}}`, `{{user_email}}`, `{{school}}`, `{{invite_code}}`, `{{signup_time}}`
