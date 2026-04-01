(function () {
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
      // Centre badge / brand / tagline on the success screen
      var card = document.querySelector('.card');
      if (card) card.classList.add('card--success');
      successEl.style.display = 'block';
      // Double rAF ensures display change is painted before opacity transition starts
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

    console.log('[Pingmart] Submitting\u2026', {
      name:  name.trim(),
      phone: fullPhone,
      email: email.trim().toLowerCase(),
    });

    // POST to the server's /submit endpoint (same-origin — no CSP connect-src issue).
    // The server forwards the payload to Google Apps Script server-side.
    fetch('/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:      name.trim(),
        phone:     fullPhone,
        email:     email.trim().toLowerCase(),
        timestamp: new Date().toISOString(),
      }),
    })
      .then(function (res) {
        console.log('[Pingmart] /submit responded:', res.status);
        if (!res.ok) throw new Error('Server error ' + res.status);
        showSuccess();
      })
      .catch(function (err) {
        console.error('[Pingmart] Submission failed:', err.message);
        errBanner.innerHTML =
          'Something went wrong. Please email us directly at ' +
          '<a href="mailto:hello@pingmart.io">hello@pingmart.io</a>';
        errBanner.style.display = 'block';
        setLoading(false);
      });
  });
})();
