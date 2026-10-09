'use strict';
// mcpConnect.js — Settings' Connect to Claude: hands the Claude desktop app Evermist's extension, which
// Claude then asks the DM to install (electron/mcpBridge.js builds it).

function initMcpConnect() {
  const btn = document.getElementById('mcp-connect'), line = document.getElementById('mcp-line');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const err = await window.electronAPI.connectClaude();
    btn.disabled = false;
    if (!err) { line.textContent = t('Claude asks to install Evermist. Press Install there.'); return; }
    messageDialog({ title: 'Claude did not open', message: t('Install the Claude desktop app, then press Connect to Claude again.') + ' (' + err + ')' });
  });
}
