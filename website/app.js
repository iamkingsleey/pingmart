(function () {
  // ── Webhook URL (Google Apps Script web app /exec endpoint) ──────────────
  // Must be deployed with "Execute as: Me" and "Who has access: Anyone".
  // With mode:'no-cors' the response is always opaque — status unreadable.
  // NOTE: 'Content-Type: text/plain' is required here. The browser enforces
  // that only safelisted Content-Type values (text/plain, multipart/form-data,
  // application/x-www-form-urlencoded) may be used in no-cors mode. Setting
  // application/json would throw a TypeError before the request is sent.
  // GAS reads the body via e.postData.contents regardless of Content-Type.
  var WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwNS0zqEmwNeyyV3p6Ik6_ChRI-712MgXtTfir4FK8Z5WNMi8UvVydtUNz6twBob2YqhQ/exec';

  // ── Diagnostic: confirm URL is set on page load ──────────────────────────
  if (WEBHOOK_URL && WEBHOOK_URL.indexOf('script.google.com') !== -1) {
    console.log('[Pingmart] Webhook URL configured: ' +
      WEBHOOK_URL.slice(0, 48) + '...' + WEBHOOK_URL.slice(-8));
  } else {
    console.warn('[Pingmart] WARNING: WEBHOOK_URL is not set or invalid!');
  }

  var form      = document.getElementById('signup-form');
  var btn       = document.getElementById('submit-btn');
  var errBanner = document.getElementById('error-banner');
  var formWrap  = document.getElementById('form-wrap');
  var successEl = document.getElementById('success-state');

  /* ── Digits-only enforcement on phone field ── */
  document.getElementById('phone').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '');
  });

  /* ── Clear field error on re-focus ── */
  ['name', 'phone', 'email'].forEach(function (id) {
    var el  = document.getElementById(id);
    var msg = document.getElementById(id + '-msg');
    el.addEventListener('focus', function () {
      el.classList.remove('field-error');
      if (msg) { msg.textContent = ''; msg.classList.remove('visible'); }
      errBanner.style.display = 'none';
    });
  });

  /* ── Inline error helpers ── */
  function fieldErr(id, text) {
    var el  = document.getElementById(id);
    var msg = document.getElementById(id + '-msg');
    el.classList.add('field-error');
    if (msg) { msg.textContent = text; msg.classList.add('visible'); }
  }

  function clearFieldErr(id) {
    var el  = document.getElementById(id);
    var msg = document.getElementById(id + '-msg');
    el.classList.remove('field-error');
    if (msg) { msg.textContent = ''; msg.classList.remove('visible'); }
  }

  function clearAllErrors() {
    ['name', 'phone', 'email'].forEach(clearFieldErr);
    errBanner.style.display = 'none';
  }

  /* ── Validation ── */
  function validate(name, phone, email) {
    var ok = true;

    var trimName = name.trim();
    if (trimName.length < 2) {
      fieldErr('name', 'Please enter your full name (at least 2 characters).');
      ok = false;
    } else if (/\d/.test(trimName)) {
      fieldErr('name', 'Name should not contain numbers.');
      ok = false;
    } else {
      clearFieldErr('name');
    }

    var digits = phone.replace(/\D/g, '');
    if (digits.length < 7) {
      fieldErr('phone', 'Please enter at least 7 digits.');
      ok = false;
    } else {
      clearFieldErr('phone');
    }

    var trimEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimEmail)) {
      fieldErr('email', 'Please enter a valid email address.');
      ok = false;
    } else {
      clearFieldErr('email');
    }

    return ok;
  }

  /* ── Loading state ── */
  function setLoading(on) {
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spinner"></span> Submitting\u2026'
      : 'Join Early Testers';
  }

  /* ── Fade transition: form out (300ms) → success in (400ms) ── */
  function showSuccess() {
    formWrap.style.opacity = '0';
    setTimeout(function () {
      formWrap.style.display = 'none';
      successEl.style.display = 'block';
      // Double rAF ensures display change is painted before opacity transition
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          successEl.style.opacity = '1';
        });
      });
    }, 310);
  }

  /* ── Submit ── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearAllErrors();

    var name     = document.getElementById('name').value;
    var phone    = document.getElementById('phone').value;
    var dialCode = document.getElementById('dial-code').value;
    var email    = document.getElementById('email').value;

    if (!validate(name, phone, email)) return;

    setLoading(true);

    var fullPhone = dialCode + ' ' + phone.trim();
    var payload   = JSON.stringify({
      name:      name.trim(),
      phone:     fullPhone,
      email:     email.trim().toLowerCase(),
      timestamp: new Date().toISOString(),
    });

    console.log('[Pingmart] Submitting\u2026', {
      name: name.trim(),
      phone: fullPhone,
      email: email.trim().toLowerCase(),
    });

    // POST directly to Google Apps Script.
    // mode:'no-cors' prevents CORS preflight; response will be opaque.
    // A completed fetch (no exception) = success — GAS wrote to the sheet.
    fetch(WEBHOOK_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body:    payload,
    })
      .then(function (res) {
        console.log('[Pingmart] Fetch completed. Response type:', res.type);
        // Opaque response (type === 'opaque') is expected with no-cors.
        // Any completion without a network exception is treated as success.
        showSuccess();
      })
      .catch(function (err) {
        console.error('[Pingmart] Fetch FAILED:', err.name, '-', err.message);
        errBanner.innerHTML =
          'Something went wrong. Please email us directly at ' +
          '<a href="mailto:hello@pingmart.io">hello@pingmart.io</a>';
        errBanner.style.display = 'block';
        setLoading(false);
      });
  });
})();
