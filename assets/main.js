(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile menu
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('mobile-menu');
  const setMenu = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });

  // Hero console: play the agent pipeline on a loop
  const steps = [...document.querySelectorAll('[data-step]')];
  const frames = [...document.querySelectorAll('.reel__frame')];
  const bar = document.getElementById('progress');

  const render = (i) => {
    steps.forEach((s, n) => {
      s.classList.toggle('is-done', n < i);
      s.classList.toggle('is-active', n === i);
    });
    const shown = Math.round((Math.min(i, steps.length) / steps.length) * frames.length);
    frames.forEach((f, n) => f.classList.toggle('is-in', n < shown));
    bar.style.width = `${(Math.min(i, steps.length) / steps.length) * 100}%`;
  };

  if (reduceMotion) {
    render(steps.length);
  } else {
    let i = 0;
    render(i);
    setInterval(() => {
      i = i > steps.length ? 0 : i + 1;
      render(i);
    }, 1300);
  }

  // Early-access form (front-end only; wire to your backend or form service)
  const form = document.querySelector('.signup');
  const msg = form.querySelector('.signup__msg');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    msg.className = `signup__msg ${ok ? 'is-ok' : 'is-err'}`;
    msg.textContent = ok
      ? "You're on the list! We'll be in touch soon."
      : 'Please enter a valid email address.';
    if (ok) form.reset();
  });

  // Use-case tabs
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  };
  tabs.forEach((tab, n) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!dir) return;
      const next = tabs[(n + dir + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });

  // Pricing billing toggle
  const billingBtns = document.querySelectorAll('[data-billing]');
  billingBtns.forEach((btn) => btn.addEventListener('click', () => {
    const period = btn.dataset.billing;
    billingBtns.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.amt[data-monthly]').forEach((el) => {
      el.textContent = `$${el.dataset[period]}`;
    });
  }));

  // Reveal sections on scroll
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const targets = document.querySelectorAll('.section__head, .how__card, .feature, .panel, .plan, .faq details, .cta__inner');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -60px 0px' });
    targets.forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  }

  document.getElementById('year').textContent = new Date().getFullYear();
})();
