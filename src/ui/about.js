'use strict';

// about.js — the About block at the foot of Settings: app mark, wordmark, version, repo, and the
// language switch above it. Builds its own DOM at init, because CLAUDE.md keeps feature logic out
// of index.html.

const ABOUT_MARK_SVG =
  '<svg class="about-mark" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<defs><clipPath id="abk"><path d="M910.4 242Q945 262 945 302L945 722Q945 762 910.4 782L546.6 992Q512 1012 477.4 992L113.6 782Q79 762 79 722L79 302Q79 262 113.6 242L477.4 32Q512 12 546.6 32Z"/></clipPath><mask id="abf" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><path d="M512 262L295.5 637M295.5 637L728.5 637M728.5 637L512 262M512 262L512 12M512 262L79 262M512 262L945 262M295.5 637L79 262M295.5 637L79 762M295.5 637L512 1012M728.5 637L945 262M728.5 637L945 762M728.5 637L512 1012M187.2 824.5L512 262L836.8 824.5" stroke="#000" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></mask><mask id="abm" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><path d="M187.2 824.5L512 262L836.8 824.5" stroke="#000" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g transform="translate(512 512) scale(1.024) translate(-512 -512)"><path d="M910.4 242Q945 262 945 302L945 722Q945 762 910.4 782L546.6 992Q512 1012 477.4 992L113.6 782Q79 762 79 722L79 302Q79 262 113.6 242L477.4 32Q512 12 546.6 32Z" fill="#0c1834"/><g clip-path="url(#abk)"><g mask="url(#abf)"><path d="M512 262L295.5 637L728.5 637Z" fill="#2f62bd"/><path d="M512 262L512 12L79 262Z" fill="#4a80d6"/><path d="M512 262L945 262L512 12Z" fill="#3d72cc"/><path d="M512 262L79 262L295.5 637Z" fill="#346ac2"/><path d="M512 262L728.5 637L945 262Z" fill="#2858a8"/><path d="M295.5 637L79 262L79 762Z" fill="#2e60b4"/><path d="M295.5 637L79 762L512 1012Z" fill="#1f4890"/><path d="M295.5 637L512 1012L728.5 637Z" fill="#24509c"/><path d="M728.5 637L512 1012L945 762Z" fill="#1a3f80"/><path d="M728.5 637L945 762L945 262Z" fill="#1f4790"/><path d="M295.5 637L79 762L187.2 824.5Z" fill="#5a82c4"/><path d="M728.5 637L836.8 824.5L945 762Z" fill="#5a82c4"/></g><g mask="url(#abm)"><path d="M512 262L187.2 824.5L512 1012Z" fill="#d6e3f6"/><path d="M512 262L512 1012L836.8 824.5Z" fill="#1d3566"/><path d="M512 262L295.5 637L512 637Z" fill="#ffffff"/></g></g></g>' +
  '</svg>';

function initAbout() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const slot = document.getElementById('legend-about');
  if (!slot) return;

  slot.innerHTML =
    ABOUT_MARK_SVG +
    '<div class="about-text">' +
      '<div class="about-wordmark">EVERMIST</div>' +
      '<div class="about-version" id="about-version" style="display:none"></div>' +
      '<div class="about-repo">github.com/Hinnful/Evermist</div>' +
      '<button type="button" class="about-link" id="about-whatsnew">What’s new</button>' +
      '<div class="about-update" id="about-update" style="display:none"></div>' +
    '</div>';

  document.getElementById('about-whatsnew').addEventListener('click', openChangelog);
  document.getElementById('settings-lang').appendChild(buildLanguageSwitch());

  // ⚠ The version comes from package.json through main, never a literal here, which goes stale on
  // the next bump. With no electronAPI the line hides rather than showing a placeholder.
  if (window.electronAPI && window.electronAPI.getAppVersion) {
    window.electronAPI.getAppVersion().then(v => {
      if (!v) return;
      const el = document.getElementById('about-version');
      el.textContent = t('Version {v}', { v: v });
      el.style.display = '';
    }).catch(() => {});
  }
}
