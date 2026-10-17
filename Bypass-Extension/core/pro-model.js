(() => {
  'use strict';
  const modes = ['off', 'study', 'work', 'relax'];
  const dayKey = (date = new Date()) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const host = value => {
    if (typeof value !== 'string' || value.length > 253) throw Error('Enter a website hostname.');
    const url = new URL(`https://${value}`);
    if (url.host !== value || !/^[a-z0-9.-]+$/i.test(value) || !value.includes('.')) throw Error('Use a hostname such as youtube.com.');
    return value.toLowerCase();
  };
  const number = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  function normalize(value = {}) {
    return { version: 1, mode: modes.includes(value.mode) ? value.mode : 'off',
      rules: Array.isArray(value.rules) ? value.rules.slice(0, 100) : [],
      schedules: Array.isArray(value.schedules) ? value.schedules.slice(0, 20) : [],
      limits: Array.isArray(value.limits) ? value.limits.slice(0, 50) : [] };
  }
  function validate(value) {
    if (!value || !modes.includes(value.mode)) throw Error('Choose a mode.');
    if (!Array.isArray(value.rules) || value.rules.length > 100 || !Array.isArray(value.schedules) || value.schedules.length > 20 || !Array.isArray(value.limits) || value.limits.length > 50) throw Error('Too many rules.');
    const rules = value.rules.map(r => {
      if (!r || !['hide', 'skip'].includes(r.kind) || typeof r.selector !== 'string' || r.selector.length > 500 || !r.selector.trim()) throw Error('Choose a specific page element.');
      if (r.kind === 'skip' && !['intro', 'recap', 'next'].includes(r.action)) throw Error('Choose a supported media action.');
      return { host: host(r.host), kind: r.kind, selector: r.selector, action: r.action || 'intro' };
    });
    const schedules = value.schedules.map(s => {
      if (!s || !modes.includes(s.mode) || s.mode === 'off' || !number(s.start, 0, 1439) || !number(s.end, 0, 1439) || s.start === s.end || !Array.isArray(s.days) || !s.days.length || s.days.some(d => !number(d, 0, 6))) throw Error('Check schedule days and times.');
      return { mode: s.mode, start: s.start, end: s.end, days: [...new Set(s.days)] };
    });
    const limits = value.limits.map(l => {
      if (!number(l.minutes, 1, 1440)) throw Error('Use a daily limit of 1–1440 minutes.');
      return { host: host(l.host), minutes: l.minutes };
    });
    return { version: 1, mode: value.mode, rules, schedules, limits };
  }
  function effectiveMode(config, date = new Date()) {
    const minute = date.getHours() * 60 + date.getMinutes(), day = date.getDay();
    for (const s of [...config.schedules].reverse()) {
      const inside = s.start < s.end
        ? s.days.includes(day) && minute >= s.start && minute < s.end
        : (s.days.includes(day) && minute >= s.start) || (s.days.includes((day + 6) % 7) && minute < s.end);
      if (inside) return s.mode;
    }
    return config.mode;
  }
  function access(license, now = Date.now()) {
    return !!license && license.kind === 'local-trial' && Number.isFinite(license.startedAt) && Number.isFinite(license.lastSeen) && now >= license.lastSeen - 300000 && now >= license.startedAt && now < license.startedAt + 7 * 86400000;
  }
  globalThis.BypassProModel = Object.freeze({ modes, dayKey, host, normalize, validate, effectiveMode, access });
})();
