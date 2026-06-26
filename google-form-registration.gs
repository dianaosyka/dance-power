const NOTIFICATION_EMAIL = 'diana.osyka@outlook.com';
const SERVICE_ACCOUNT_PROPERTY = 'SERVICE_ACCOUNT_JSON';
const FIELD_FULL_NAME = `Meno a priezvisko

🇺🇦‼️ будь ласка, не використовуйте українські букви, напишіть латиницею`;
const FIELD_EMAIL = 'Адрес электронной почты';
const FIELD_PHONE = 'Telefónne číslo (+421 XXX XXX XXX)';
const FIELD_INSTAGRAM = 'Instagram — náš hlavný komunikačný kanál, preto vyžadujeme: NickName v Instagram (@XXX)';

function onFormSubmit(e) {
  const values = e?.namedValues || {};

  const submitted = {
    fullName: getExactValue(values, FIELD_FULL_NAME),
    phone: getExactValue(values, FIELD_PHONE),
    instagram: getExactValue(values, FIELD_INSTAGRAM),
    email: getExactValue(values, FIELD_EMAIL),
  };

  try {
    if (!e?.namedValues) {
      throw new Error('No form data received. Do not run onFormSubmit manually; submit the Google Form or use an installable spreadsheet trigger.');
    }

    const student = buildStudent(submitted);
    const existingId = findStudentByPhone(student.phone);

    if (existingId) {
      throw new Error(`Student with this phone already exists: ${existingId}`);
    }

    const studentId = createStudent(student);

    MailApp.sendEmail(
      NOTIFICATION_EMAIL,
      'New student added',
      [
        'Student was successfully added.',
        '',
        `Name: ${student.name}`,
        `Phone: ${student.phone}`,
        `Email: ${student.email || '-'}`,
        `Instagram: ${student.instagram || '-'}`,
        `Student ID: ${studentId}`,
      ].join('\n')
    );
  } catch (error) {
    MailApp.sendEmail(
      NOTIFICATION_EMAIL,
      'Student registration error',
      [
        'Student was NOT added.',
        '',
        `Error: ${error.message}`,
        '',
        `Received fields: ${Object.keys(values).join(', ') || 'none'}`,
        '',
        'Submitted data:',
        JSON.stringify(submitted, null, 2),
      ].join('\n')
    );
  }
}

function getExactValue(values, fieldName) {
  const value = values[fieldName];
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function getNamedValue(values, possibleNames) {
  const normalizedEntries = Object.entries(values).map(([key, value]) => ({
    key,
    normalizedKey: normalizeFieldName(key),
    value,
  }));

  for (const name of possibleNames) {
    const normalizedName = normalizeFieldName(name);
    const match = normalizedEntries.find(entry =>
      entry.normalizedKey === normalizedName ||
      entry.normalizedKey.includes(normalizedName)
    );

    if (match) {
      return Array.isArray(match.value) ? match.value[0] || '' : match.value || '';
    }
  }

  return '';
}

function normalizeFieldName(name) {
  return String(name || '')
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildStudent(submitted) {
  const name = normalizeName(submitted.fullName);
  const phone = normalizePhone(submitted.phone);

  return {
    name,
    phone,
    groups: [],
    instagram: normalizeInstagram(submitted.instagram),
    email: submitted.email,
    source: 'google-form',
  };
}

function normalizeName(fullName) {
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');

  if (!name) {
    throw new Error('Full name is required.');
  }

  if (/\p{Script=Cyrillic}/u.test(name)) {
    throw new Error('Full name cannot contain Cyrillic letters.');
  }

  const parts = name.split(' ');

  if (parts.length < 2) {
    throw new Error('Full name must include name and surname.');
  }

  return parts
    .map(part => {
      const lower = part.toLocaleLowerCase('sk-SK');
      return lower.charAt(0).toLocaleUpperCase('sk-SK') + lower.slice(1);
    })
    .join(' ');
}

function normalizePhone(phone) {
  const raw = String(phone || '').trim();

  if (!raw) {
    throw new Error('Phone number is required.');
  }

  let numbersOnly = raw.replace(/\D/g, '');

  if (numbersOnly.startsWith('0')) {
    numbersOnly = `421${numbersOnly.slice(1)}`;
  }

  if (!numbersOnly.startsWith('421')) {
    throw new Error('Phone number must be Slovak and start with +421.');
  }

  if (numbersOnly.length !== 12) {
    throw new Error('Phone number must be in format +421 XXX XXX XXX.');
  }

  return `+421 ${numbersOnly.slice(3, 6)} ${numbersOnly.slice(6, 9)} ${numbersOnly.slice(9, 12)}`;
}

function normalizeInstagram(instagram) {
  const value = String(instagram || '').trim();

  if (!value) {
    return '';
  }

  const cleaned = value
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@+/, '')
    .replace(/\/+$/, '')
    .trim();

  return cleaned ? `@${cleaned}` : '';
}

function findStudentByPhone(phone) {
  const serviceAccount = getServiceAccount();
  const url = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents:runQuery`;

  const response = fetchFirestore(url, {
    structuredQuery: {
      from: [{ collectionId: 'students' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'phone' },
          op: 'EQUAL',
          value: { stringValue: phone },
        },
      },
      limit: 1,
    },
  });

  for (const row of response) {
    if (row.document?.name) {
      return row.document.name.split('/').pop();
    }
  }

  return '';
}

function createStudent(student) {
  const serviceAccount = getServiceAccount();
  const url = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents/students`;

  const response = fetchFirestore(url, {
    fields: toFirestoreFields({
      ...student,
      createdAt: new Date().toISOString(),
    }),
  });

  return response.name.split('/').pop();
}

function fetchFirestore(url, payload) {
  const token = getAccessToken();
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  const data = text ? JSON.parse(text) : {};

  if (status < 200 || status >= 300) {
    throw new Error(data.error?.message || `Firestore request failed with status ${status}`);
  }

  return data;
}

function getAccessToken() {
  const serviceAccount = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: serviceAccount.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const unsignedJwt = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = Utilities.computeRsaSha256Signature(unsignedJwt, serviceAccount.private_key);
  const jwt = `${unsignedJwt}.${base64Url(signature)}`;

  const response = UrlFetchApp.fetch(serviceAccount.token_uri, {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const data = JSON.parse(response.getContentText());

  if (status < 200 || status >= 300) {
    throw new Error(data.error_description || data.error || 'Failed to get Google access token.');
  }

  return data.access_token;
}

function getServiceAccount() {
  const json = PropertiesService
    .getScriptProperties()
    .getProperty(SERVICE_ACCOUNT_PROPERTY);

  if (!json) {
    throw new Error(`Missing Apps Script property: ${SERVICE_ACCOUNT_PROPERTY}`);
  }

  return JSON.parse(json);
}

function toFirestoreFields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)])
  );
}

function toFirestoreValue(value) {
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(item => toFirestoreValue(item)),
      },
    };
  }

  if (typeof value === 'number') {
    return { doubleValue: value };
  }

  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  return { stringValue: String(value) };
}

function base64Url(value) {
  const bytes = typeof value === 'string' ? Utilities.newBlob(value).getBytes() : value;
  return Utilities
    .base64EncodeWebSafe(bytes)
    .replace(/=+$/, '');
}
