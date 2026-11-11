import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required. Create a separate Neon test branch and set its pooled connection URL before running npm test.',
  );
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL; never run integration tests against production.');
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_SECRET = 'test-only-jwt-secret-not-for-production-12345';

const { default: app } = await import('../src/app.js');
const { sql } = await import('../src/db.js');
const runId = randomUUID();
const emails = [];

after(async () => {
  if (emails.length > 0) {
    await sql`DELETE FROM users WHERE email = ANY(${emails}::text[])`;
  }
});

async function registerUser(label) {
  const email = `notes-${runId}-${label}@example.test`;
  emails.push(email);

  const response = await request(app)
    .post('/api/auth/register')
    .send({ name: `Test ${label}`, email, password: 'TestPassword123!' });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.user.email, email);
  assert.equal(Object.hasOwn(response.body.user, 'password_hash'), false);
  assert.equal(typeof response.body.token, 'string');

  const payload = jwt.verify(response.body.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  assert.equal(payload.sub, response.body.user.id);
  return { email, user: response.body.user, token: response.body.token };
}

test('registers, logs in, and returns the current user without password hashes', async () => {
  const email = `notes-${runId}-flow@example.test`;
  emails.push(email);

  const registration = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test Flow', email: email.toUpperCase(), password: 'TestPassword123!' });

  assert.equal(registration.status, 201, JSON.stringify(registration.body));
  assert.equal(registration.body.user.email, email);
  assert.equal(Object.hasOwn(registration.body.user, 'password_hash'), false);
  assert.equal(jwt.decode(registration.body.token).sub, registration.body.user.id);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: email.toUpperCase(), password: 'TestPassword123!' });

  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.id, registration.body.user.id);
  assert.equal(Object.hasOwn(login.body.user, 'password_hash'), false);

  const currentUser = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${login.body.token}`);

  assert.equal(currentUser.status, 200, JSON.stringify(currentUser.body));
  assert.deepEqual(currentUser.body.user, registration.body.user);
});

test('requires a valid bearer token for notes', async () => {
  const missing = await request(app).get('/api/notes');
  assert.equal(missing.status, 401);
  assert.match(missing.headers['www-authenticate'], /^Bearer/);

  const garbled = await request(app)
    .get('/api/notes')
    .set('Authorization', 'Bearer not-a-jwt');
  assert.equal(garbled.status, 401);
  assert.match(garbled.headers['www-authenticate'], /invalid_token/);

  const expiredToken = jwt.sign(
    { sub: '00000000-0000-0000-0000-000000000001' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: -1 },
  );
  const expired = await request(app)
    .get('/api/notes')
    .set('Authorization', `Bearer ${expiredToken}`);
  assert.equal(expired.status, 401);
  assert.match(expired.headers['www-authenticate'], /invalid_token/);
});

test('prevents users from reading, updating, or deleting another user’s note', async () => {
  const owner = await registerUser('owner');
  const other = await registerUser('other');

  const created = await request(app)
    .post('/api/notes')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ title: 'Private note', body: 'Only the owner can access this.' });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  const noteId = created.body.note.id;

  const get = await request(app)
    .get(`/api/notes/${noteId}`)
    .set('Authorization', `Bearer ${other.token}`);
  assert.equal(get.status, 404);

  const patch = await request(app)
    .patch(`/api/notes/${noteId}`)
    .set('Authorization', `Bearer ${other.token}`)
    .send({ title: 'Unauthorized update' });
  assert.equal(patch.status, 404);

  const remove = await request(app)
    .delete(`/api/notes/${noteId}`)
    .set('Authorization', `Bearer ${other.token}`);
  assert.equal(remove.status, 404);

  const list = await request(app)
    .get('/api/notes')
    .set('Authorization', `Bearer ${other.token}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.notes.some((note) => note.id === noteId), false);

  const ownerCanStillRead = await request(app)
    .get(`/api/notes/${noteId}`)
    .set('Authorization', `Bearer ${owner.token}`);
  assert.equal(ownerCanStillRead.status, 200);
});
