(function () {
  var form      = document.getElementById('signup-form');
  var btn       = document.getElementById('submit-btn');
  var errBanner = document.getElementById('error-banner');
  var formWrap  = document.getElementById('form-wrap');
  var successEl = document.getElementById('success-state');

  function showErr(html) {
    errBanner.innerHTML = html;
    errBanner.style.display = 'block';
  }
  function hideErr() {
    errBanner.style.display = 'none';
    errBanner.innerHTML = '';
  }
  function setLoading(on) {
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spinner"></span> Submitting\u2026'
      : 'Join Early Testers';
  }

  ['name', 'phone', 'email'].forEach(function (id) {
    document.getElementById(id).addEventListener('focus', function () {
      this.classList.remove('field-error');
      hideErr();
    });
  });

  function validate(name, phone, email) {
    if (!name.trim()) {
      document.getElementById('name').classList.add('field-error');
      return 'Please enter your full name.';
    }
    if (!phone.trim()) {
      document.getElementById('phone').classList.add('field-error');
      return 'Please enter your phone number.';
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      document.getElementById('email').classList.add('field-error');
      return 'Please enter a valid email address.';
    }
    return null;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideErr();

    var name  = document.getElementById('name').value;
    var phone = document.getElementById('phone').value;
    var email = document.getElementById('email').value;

    var invalid = validate(name, phone, email);
    if (invalid) { showErr(invalid); return; }

    setLoading(true);

    fetch('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:      name.trim(),
        phone:     phone.trim(),
        email:     email.trim().toLowerCase(),
        timestamp: new Date().toISOString(),
      }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Server error');
        formWrap.style.display  = 'none';
        successEl.style.display = 'block';
      })
      .catch(function () {
        showErr(
          'Something went wrong. Please email us directly at ' +
          '<a href="mailto:hello@pingmart.io">hello@pingmart.io</a>'
        );
        setLoading(false);
      });
  });
})();
