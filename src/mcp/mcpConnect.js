'use strict';
// mcpConnect.js — Settings' Claude line: Connect hands the Claude desktop app Evermist's extension, which Claude then
// asks the DM to install, and ends any refusal; Disconnect makes Evermist refuse every Claude call on this computer
// (electron/mcpBridge.js builds the extension and keeps the state).

function _mcPaint(st) {
  const on = !st.off && st.seen;
  const line = document.getElementById('mcp-line');
  line.textContent = t(on ? 'Connected' : 'Not connected');
  line.classList.toggle('on', on);
  document.getElementById('mcp-connect').hidden = on;
  document.getElementById('mcp-disconnect').hidden = !on;
}

async function _mcRead() {
  try { _mcPaint(await window.electronAPI.claudeState()); } catch (err) { console.error('[mcp]', err); }
}

function initMcpConnect() {
  const btn = document.getElementById('mcp-connect'), off = document.getElementById('mcp-disconnect');
  if (!btn || !window.electronAPI || !window.electronAPI.claudeState) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const err = await window.electronAPI.connectClaude();
    btn.disabled = false;
    await _mcRead();
    if (!err) { noticeToast(t('Claude asks to install Evermist. Press Install there.')); return; }
    messageDialog({ title: 'Claude did not open', message: t('Install the Claude desktop app, then press Connect to Claude again.') + ' (' + err + ')' });
  });
  off.addEventListener('click', async () => {
    off.disabled = true;
    try { _mcPaint(await window.electronAPI.disconnectClaude()); } catch (err) { console.error('[mcp]', err); }
    off.disabled = false;
  });
  document.addEventListener('dockpane', e => { if (e.detail === 'settings') _mcRead(); });
  _mcRead();
}
