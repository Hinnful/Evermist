'use strict';
// mcpGallery.js — Claude's gallery tools: list, add, rename and delete pictures. Never one on the TV: a
// picture the TV shows is not deleted from here, and nothing here shows one.

function _mcpPicture(name) {
  const q = String(name || '').trim().toLowerCase();
  const hits = galleryList().filter(p => p.name.trim().toLowerCase() === q);
  if (hits.length === 1) return { pic: hits[0] };
  if (!hits.length) return { error: 'No picture is called "' + (name || '') + '". list_gallery shows them.' };
  return { error: 'More than one picture is called "' + name + '". Rename one in Evermist first.' };
}

function _mcpListGallery(args) {
  const q = String(args.query || '').trim().toLowerCase();
  const pics = galleryList().filter(p => !q || p.name.toLowerCase().includes(q));
  return _mcpOk({ total: pics.length, pictures: pics.slice(0, 100).map(p => ({ name: p.name, type: p.type, sizeKB: Math.round(p.size / 1024), added: new Date(p.added).toISOString() })) });
}

async function _mcpAddPicture(args) {
  const read = await window.electronAPI.readMapFiles(String(args.path || ''));
  if (read.error) return _mcpNo(read.error);
  const images = read.files.filter(f => /^image\//.test(f.type));
  if (!images.length) return _mcpNo('The gallery holds pictures, and no image was found at that path.');
  const added = [], failed = [];
  for (const f of images) {
    const p = await galleryAddFile(new File([f.bytes], f.name, { type: f.type }));
    if (p) added.push(p); else failed.push('"' + f.name + '" would not open as a picture.');
  }
  if (!added.length) return _mcpNo('Nothing was added. ' + failed.join(' '));
  if (args.name && added.length === 1) galleryRenameTo(added[0].id, String(args.name).trim() || added[0].name);
  const now = added.map(p => '"' + galleryList().find(x => x.id === p.id).name + '"');
  const left = [...failed, ...read.files.filter(f => !/^image\//.test(f.type)).map(f => '"' + f.name + '" is not an image.'), ...read.skipped.map(s => '"' + s.name + '" ' + s.reason)];
  return mcpDone('added ' + now.join(', ') + ' to the gallery', async () => { for (const p of added) await galleryDrop(p.id); },
    'Added ' + now.join(', ') + ' to the gallery. Nothing was shown on the TV.' + (left.length ? ' Left out: ' + left.join(' ') : ''));
}

function _mcpRenamePicture(args) {
  const found = _mcpPicture(args.name);
  if (found.error) return _mcpNo(found.error);
  const to = String(args.newName || '').trim();
  if (!to) return _mcpNo('A picture needs a name.');
  const was = found.pic.name;
  galleryRenameTo(found.pic.id, to);
  return mcpDone('renamed the picture "' + was + '" to "' + to + '"', async () => galleryRenameTo(found.pic.id, was), 'Renamed the picture "' + was + '" to "' + to + '".');
}

async function _mcpDeletePicture(args) {
  const found = _mcpPicture(args.name);
  if (found.error) return _mcpNo(found.error);
  const id = found.pic.id;
  if (galleryOnTv(id)) return _mcpNo('Not deleted: the TV shows "' + found.pic.name + '" now. Ask the DM to take it down first.');
  const kept = await galleryDrop(id);
  return mcpDone('deleted the picture "' + found.pic.name + '"', () => galleryRestore(kept), 'Deleted the picture "' + found.pic.name + '".');
}

const MCP_GALLERY_TOOLS = { list_gallery: _mcpListGallery, add_picture: _mcpAddPicture, rename_picture: _mcpRenamePicture, delete_picture: _mcpDeletePicture };
