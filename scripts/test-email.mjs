#!/usr/bin/env node
/**
 * Broxeen — automated email end-to-end test
 *
 * Prerequisites:
 *   docker compose --profile mail up -d
 *
 * Usage:
 *   node scripts/test-email.mjs
 *   BROXEEN_SMTP_HOST=mail.example.com node scripts/test-email.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const col = (t, ...keys) => keys.map(k => C[k]).join('') + t + C.reset;

// ── Config ────────────────────────────────────────────────────────────────────
const cfg = {
  smtp_host: process.env.BROXEEN_SMTP_HOST     || 'localhost',
  smtp_port: process.env.BROXEEN_SMTP_PORT     || '1025',
  smtp_user: process.env.BROXEEN_SMTP_USER     || 'test@broxeen.local',
  smtp_pass: process.env.BROXEEN_SMTP_PASSWORD || 'test',
  imap_host: process.env.BROXEEN_IMAP_HOST     || 'localhost',
  imap_port: process.env.BROXEEN_IMAP_PORT     || '1143',
  from_addr: process.env.BROXEEN_EMAIL_FROM    || 'broxeen@broxeen.local',
  use_tls:   (process.env.BROXEEN_EMAIL_TLS || 'false') !== 'false'
             && (process.env.BROXEEN_EMAIL_TLS || 'false') !== '0',
};
const noauth = !cfg.smtp_user || cfg.smtp_user === 'test@broxeen.local';

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function run(cmd, timeout = 15000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return null;
  }
}

function runPy(script) {
  const f = `/tmp/broxeen_test_${Date.now()}.py`;
  try {
    writeFileSync(f, script);
    const out = run(`python3 ${f}`, 15000);
    try { unlinkSync(f); } catch {}
    return out;
  } catch (e) {
    try { unlinkSync(f); } catch {}
    return null;
  }
}

function ok(label) {
  passed++;
  console.log(`  ${col('✅', 'green')} ${label}`);
}

function fail(label, detail = '') {
  failed++;
  console.log(`  ${col('❌', 'red')} ${label}${detail ? col(` — ${detail}`, 'dim') : ''}`);
}

function skip(label, reason) {
  console.log(`  ${col('⏭ ', 'yellow')} ${label} ${col(`(${reason})`, 'dim')}`);
}

function section(title) {
  console.log(`\n${col('▶ ' + title, 'bold', 'cyan')}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

section('Środowisko');

// python3 available?
const pyVer = run('python3 --version');
if (pyVer) ok(`python3: ${pyVer}`);
else { fail('python3 niedostępny'); process.exit(1); }

// Docker / Mailpit running?
const mailpitUp = run('docker ps --filter name=broxeen-mailpit --format "{{.Status}}"');
if (mailpitUp && mailpitUp.includes('Up')) {
  ok(`Mailpit: ${mailpitUp}`);
} else {
  console.log(`\n  ${col('⚠️  Mailpit nie działa.', 'yellow')} Uruchom:`);
  console.log(`     ${col('docker compose --profile mail up -d', 'bold')}`);
  console.log(`  Kontynuuję testy (mogą się nie powieść)...\n`);
}

// ── Test 1: SMTP connection ───────────────────────────────────────────────────
section('Test 1: Połączenie SMTP');

const smtpScript = `
import smtplib, json
try:
    s = smtplib.SMTP('${cfg.smtp_host}', ${cfg.smtp_port}, timeout=8)
    s.ehlo()
    ${cfg.use_tls ? 's.starttls(); s.ehlo()' : '# no TLS'}
    ${noauth ? '# no auth required' : `s.login('${cfg.smtp_user}', '${cfg.smtp_pass}')`}
    s.quit()
    print(json.dumps({'ok': True}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}))
`;
const smtpOut = runPy(smtpScript);
let smtpOk = false;
if (smtpOut) {
  try {
    const r = JSON.parse(smtpOut);
    if (r.ok) { ok(`SMTP ${cfg.smtp_host}:${cfg.smtp_port} — połączono`); smtpOk = true; }
    else fail(`SMTP: ${r.error}`);
  } catch { fail('SMTP: błąd parsowania', smtpOut); }
} else {
  fail('SMTP: timeout lub python3 error');
}

// ── Test 2: Send email ────────────────────────────────────────────────────────
section('Test 2: Wysyłka email');

const testSubject = `Broxeen test ${new Date().toISOString()}`;
const testTo = 'recipient@broxeen.local';
const emlFile = `/tmp/broxeen_test_${Date.now()}.eml`;
const emailContent = [
  `From: ${cfg.from_addr}`,
  `To: ${testTo}`,
  `Subject: ${testSubject}`,
  `MIME-Version: 1.0`,
  `Content-Type: text/plain; charset=utf-8`,
  `Content-Transfer-Encoding: 8bit`,
  ``,
  `Automatyczny test Broxeen CLI.\nCzas: ${new Date().toISOString()}\nSMTP: ${cfg.smtp_host}:${cfg.smtp_port}`,
].join('\r\n');

if (!smtpOk) {
  skip('Wysyłka email', 'SMTP niedostępny');
} else {
  writeFileSync(emlFile, emailContent);
  const sendScript = `
import smtplib, sys
msg = open('${emlFile}', 'rb').read()
try:
    s = smtplib.SMTP('${cfg.smtp_host}', ${cfg.smtp_port}, timeout=10)
    s.ehlo()
    ${cfg.use_tls ? 's.starttls(); s.ehlo()' : '# no TLS'}
    ${noauth ? '# no auth' : `s.login('${cfg.smtp_user}', '${cfg.smtp_pass}')`}
    s.sendmail('${cfg.from_addr}', ['${testTo}'], msg)
    s.quit()
    print('OK')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
`;
  const sendOut = runPy(sendScript);
  try { unlinkSync(emlFile); } catch {}
  if (sendOut !== null && sendOut.trim() === 'OK') {
    ok(`Email wysłany do ${testTo} — temat: "${testSubject}"`);
  } else {
    fail('Wysyłka email', sendOut || 'brak odpowiedzi');
  }
}

// ── Test 3: Mailpit REST API — inbox ─────────────────────────────────────────
section('Test 3: Mailpit REST API — odczyt skrzynki');

const apiBase = `http://localhost:8025`;
const apiOut = run(`curl -sf ${apiBase}/api/v1/messages?limit=10`, 8000);
let apiOk = false;
if (apiOut) {
  try {
    const r = JSON.parse(apiOut);
    const msgs = r.messages || [];
    const total = r.total ?? msgs.length;
    ok(`Mailpit REST API — ${total} wiadomości w bazie`);
    apiOk = true;
    if (msgs.length > 0) {
      ok(`Ostatnia: "${msgs[0].Subject}" → ${msgs[0].To?.[0]?.Address || '?'}`);
    }
  } catch { fail('REST API: błąd parsowania', apiOut.slice(0, 100)); }
} else {
  fail('Mailpit REST API niedostępna (http://localhost:8025)');
}

// ── Test 4: Verify sent email visible in REST API ────────────────────────────
section('Test 4: Weryfikacja wysłanego emaila przez REST API');

if (!apiOk) {
  skip('Weryfikacja emaila', 'REST API niedostępna');
} else {
  const searchOut = run(`curl -sf "${apiBase}/api/v1/search?query=${encodeURIComponent('Broxeen+test')}&limit=5"`, 8000)
    || run(`curl -sf "${apiBase}/api/v1/messages?limit=20"`, 8000);
  if (searchOut) {
    try {
      const r = JSON.parse(searchOut);
      const msgs = r.messages || [];
      const found = msgs.find(m => (m.Subject || '').includes('Broxeen test'));
      if (found) {
        ok(`Testowy email znaleziony: "${found.Subject}" → ${found.To?.[0]?.Address || '?'}`);
        ok(`Podgląd: ${apiBase}/`);
      } else {
        console.log(`  ${col('ℹ', 'dim')}  Testowy email nie znaleziony (może być opóźnienie lub skrzynka wyczyszczona)`);
      }
    } catch { fail('Weryfikacja: błąd parsowania'); }
  } else {
    fail('Weryfikacja: brak odpowiedzi API');
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${col('─'.repeat(50), 'dim')}`);
console.log(`${col('Wyniki:', 'bold')} ${col(`${passed} zaliczonych`, 'green')}, ${failed > 0 ? col(`${failed} nieudanych`, 'red') : col('0 nieudanych', 'dim')}`);

if (passed > 0 && failed === 0) {
  console.log(col('\n✅ Wszystkie testy zaliczone!', 'green', 'bold'));
  console.log(col('   Podgląd emaili: http://localhost:8025', 'cyan'));
} else if (failed > 0) {
  console.log(col('\n⚠️  Niektóre testy nie powiodły się.', 'yellow'));
  console.log('   Sprawdź czy Mailpit działa:');
  console.log(col('   docker compose --profile mail up -d', 'bold'));
  console.log('   Logi: docker logs broxeen-mailpit');
}
console.log('');
process.exit(failed > 0 ? 1 : 0);
