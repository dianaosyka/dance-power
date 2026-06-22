const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const NOTIFICATION_EMAIL = 'diana.osyka@outlook.com';
const formSecret = defineSecret('FORM_SECRET');

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

function getFirstValue(body, names) {
  for (const name of names) {
    const value = body?.[name];

    if (Array.isArray(value) && value[0]) {
      return value[0];
    }

    if (value) {
      return value;
    }
  }

  return '';
}

function buildErrorResponse(error, submitted) {
  return {
    ok: false,
    error: error.message || String(error),
    submitted,
    notificationEmail: NOTIFICATION_EMAIL,
  };
}

exports.createStudentFromForm = onRequest({ cors: false, secrets: [formSecret] }, async (req, res) => {
  const submitted = req.body || {};

  try {
    if (req.method !== 'POST') {
      return res.status(405).json(buildErrorResponse(new Error('Method not allowed.'), submitted));
    }

    const expectedSecret = formSecret.value();

    if (!expectedSecret) {
      throw new Error('FORM_SECRET is not configured in Firebase Functions.');
    }

    if (req.get('x-form-secret') !== expectedSecret) {
      return res.status(401).json(buildErrorResponse(new Error('Unauthorized.'), submitted));
    }

    const name = normalizeName(getFirstValue(submitted, ['Full name', 'fullName', 'name']));
    const phone = normalizePhone(getFirstValue(submitted, ['Phone number', 'phone']));
    const groupId = String(getFirstValue(submitted, ['Group ID', 'groupId']) || '').trim();
    const instagram = normalizeInstagram(getFirstValue(submitted, ['Instagram', 'instagram']));

    const duplicateSnap = await admin
      .firestore()
      .collection('students')
      .where('phone', '==', phone)
      .limit(1)
      .get();

    if (!duplicateSnap.empty) {
      const duplicate = duplicateSnap.docs[0];
      return res.status(409).json(buildErrorResponse(
        new Error(`Student with this phone already exists: ${duplicate.id}`),
        { name, phone, groupId, instagram }
      ));
    }

    const docRef = await admin.firestore().collection('students').add({
      name,
      phone,
      groups: groupId ? [groupId] : [],
      instagram,
      source: 'google-form',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      ok: true,
      studentId: docRef.id,
      student: {
        name,
        phone,
        groupId,
        instagram,
      },
      notificationEmail: NOTIFICATION_EMAIL,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json(buildErrorResponse(error, submitted));
  }
});
