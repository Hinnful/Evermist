'use strict';

// about.js — the About block: app mark, wordmark, version, repo.
//
// The FOOTER of the shortcut legend, not a box of its own: the app has one "what is this" button.
// Builds its own DOM at init, because CLAUDE.md keeps feature logic out of index.html.

const ABOUT_MARK_SVG =
  '<svg class="about-mark" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M784 40H240C129.543 40 40 129.543 40 240V784C40 894.457 129.543 984 240 984H784C894.457 984 984 894.457 984 784V240C984 129.543 894.457 40 784 40Z" fill="url(#ab_p0)"/>' +
    '<mask id="ab_m0" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="40" y="40" width="944" height="944">' +
      '<path d="M784 40H240C129.543 40 40 129.543 40 240V784C40 894.457 129.543 984 240 984H784C894.457 984 984 894.457 984 784V240C984 129.543 894.457 40 784 40Z" fill="white"/>' +
    '</mask>' +
    '<g mask="url(#ab_m0)">' +
      '<path opacity="0.72" d="M512 770C677.685 770 812 635.685 812 470C812 304.315 677.685 170 512 170C346.315 170 212 304.315 212 470C212 635.685 346.315 770 512 770Z" fill="url(#ab_p1)"/>' +
      '<path d="M70 994L512 300L954 994H70Z" fill="url(#ab_p2)"/>' +
      '<path opacity="0.22" d="M512 300V994H70L512 300Z" fill="#16121F"/>' +
      '<path d="M512 300L661 534L512 627L363 534L512 300Z" fill="#F4EEFF"/>' +
      '<g opacity="0.2" filter="url(#ab_f0)">' +
        '<path d="M21.2668 735.936C213.345 656.021 384.081 656.021 533.475 735.936C682.87 815.85 839.378 809.19 1003 715.957V871.789C695.675 946.376 453.799 941.048 277.371 855.807C100.944 770.565 15.5756 777.224 21.2668 875.785V735.936Z" fill="#CDBEF2"/>' +
      '</g>' +
      '<g opacity="0.2" filter="url(#ab_f1)">' +
        '<path d="M-50 815C174.783 745.667 377.087 745.667 556.913 815C736.739 884.333 879.101 877.111 984 793.333V1049H-50V815Z" fill="#CDBEF2"/>' +
      '</g>' +
    '</g>' +
    '<path d="M784 40.5H240C129.819 40.5 40.5 129.819 40.5 240V784C40.5 894.181 129.819 983.5 240 983.5H784C894.181 983.5 983.5 894.181 983.5 784V240C983.5 129.819 894.181 40.5 784 40.5Z" stroke="#7A5FD0" stroke-opacity="0.32" stroke-width="2"/>' +
    '<defs>' +
      '<filter id="ab_f0" x="3" y="658" width="1018" height="284" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' +
        '<feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
        '<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>' +
        '<feGaussianBlur stdDeviation="9" result="effect1_foregroundBlur"/>' +
      '</filter>' +
      '<filter id="ab_f1" x="-68" y="745" width="1070" height="322" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' +
        '<feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
        '<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>' +
        '<feGaussianBlur stdDeviation="9" result="effect1_foregroundBlur"/>' +
      '</filter>' +
      '<linearGradient id="ab_p0" x1="40" y1="40" x2="40" y2="984" gradientUnits="userSpaceOnUse">' +
        '<stop stop-color="#271D44"/><stop offset="0.55" stop-color="#1A1A2E"/><stop offset="1" stop-color="#110E20"/>' +
      '</linearGradient>' +
      '<radialGradient id="ab_p1" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(512 470) scale(300)">' +
        '<stop stop-color="#E9DEFF" stop-opacity="0.9"/><stop offset="0.45" stop-color="#9A78E0" stop-opacity="0.38"/><stop offset="1" stop-color="#9A78E0" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<linearGradient id="ab_p2" x1="70" y1="300" x2="70" y2="994" gradientUnits="userSpaceOnUse">' +
        '<stop stop-color="#E2D9F6"/><stop offset="0.5" stop-color="#7E68C0"/><stop offset="1" stop-color="#3D6AB0"/>' +
      '</linearGradient>' +
    '</defs>' +
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
    '</div>';

  // ⚠ The version comes from package.json through main, never a literal here, which goes stale on
  // the next bump. With no electronAPI the line hides rather than showing a placeholder.
  if (window.electronAPI && window.electronAPI.getAppVersion) {
    window.electronAPI.getAppVersion().then(v => {
      if (!v) return;
      const el = document.getElementById('about-version');
      el.textContent = 'Version ' + v;
      el.style.display = '';
    }).catch(() => {});
  }
}
