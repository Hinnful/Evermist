'use strict';
// mcpGallery.js — Claude's gallery tools: list, add, rename and delete pictures, and their order and groups. Never one on the TV: a
// picture the TV shows is not deleted from here, and nothing here shows one.

// Every picture in the order Pictures shows them, with its group: { key, label, group, pic }.
function _mcpPictureItems() {
  const by = new Map(galleryList().map(p => [p.id, p]));
  const L = galleryLayoutNow();
  return libSections(L, [...by.keys()]).flatMap(s => s.items.map(id => ({ key: id, label: by.get(id).name, group: s.key ? galleryGroupName(s.key) : null, pic: by.get(id) })));
}

function _mcpPictureGroups() {
  const L = galleryLayoutNow(), ids = galleryList().map(p => p.id);
  return libSections(L, ids).filter(s => s.key).map(s => ({ key: s.key, name: galleryGroupName(s.key) }));
}

// The picture a name points at; two pictures of one name are refused with both named.
function _mcpPicture(name) {
  const q = String(name || '').trim().toLowerCase();
  const items = _mcpPictureItems();
  const exact = items.filter(x => x.label.trim().toLowerCase() === q);
  const one = mcpLibOne(exact.length ? exact : [], name, 'picture', 'list_gallery');
  return one.error ? { error: one.error } : { pic: one.item.pic };
}

function _mcpListGallery(args) {
  const q = String(args.query || '').trim().toLowerCase();
  const pics = _mcpPictureItems().filter(x => !q || x.label.toLowerCase().includes(q));
  return _mcpOk({ total: pics.length, groups: _mcpPictureGroups().map(g => g.name),
    pictures: pics.slice(0, 100).map(x => ({ name: x.label, group: x.group, type: x.pic.type, sizeKB: Math.round(x.pic.size / 1024), added: new Date(x.pic.added).toISOString() })) });
}

// The layout put back as it was before a step, keeping whatever came or went meanwhile.
const _mcpPicturesBack = before => async () => galleryCommit(libNormalize(before, galleryList().map(p => p.id)));

function _mcpSetPictureGroup(args) {
  const many = mcpLibMany(_mcpPictureItems(), args.pictures, 'picture', 'list_gallery');
  if (many.error) return _mcpNo(many.error);
  const group = args.group ? mcpLibGroup(_mcpPictureGroups(), args.group) : null;
  if (args.group && !group) return _mcpNo('No picture group is called "' + args.group + '". create_picture_group makes one.');
  const before = galleryLayoutNow();
  galleryCommit(libMoveTo(before, many.items.map(x => x.key), group ? group.key : null, mcpLibIndex(args.position), galleryList().map(p => p.id)));
  const shown = many.items.map(x => '"' + x.label + '"').join(', '), where = group ? 'into the picture group "' + group.name + '"' : 'into no group';
  return mcpDone('moved ' + shown + ' ' + where, _mcpPicturesBack(before), 'Moved ' + shown + ' ' + where + (args.position ? ' at position ' + args.position : '') + '.');
}

function _mcpCreatePictureGroup(args) {
  const name = sanitizeGroupName(args.name);
  if (!name) return _mcpNo('A group needs a name.');
  if (mcpLibGroup(_mcpPictureGroups(), name)) return _mcpNo('There is already a picture group called "' + name + '".');
  const many = mcpLibMany(_mcpPictureItems(), args.pictures, 'picture', 'list_gallery');
  if (many.error) return _mcpNo(many.error + ' A group is made with at least one picture in it.');
  const before = galleryLayoutNow(), gk = galleryNewGroupKey(), L = libClone(before);
  L.groups[gk] = { name, members: [] };
  L.groupOrder.unshift(gk);
  galleryCommit(libMove(L, many.items.map(x => x.key), gk, null));
  return mcpDone('made the picture group "' + name + '"', _mcpPicturesBack(before), 'Made the picture group "' + name + '", first after the ungrouped pictures.');
}

function _mcpRenamePictureGroup(args) {
  const g = mcpLibGroup(_mcpPictureGroups(), args.name);
  if (!g) return _mcpNo('No picture group is called "' + (args.name || '') + '". list_gallery shows the groups.');
  const to = sanitizeGroupName(args.newName);
  if (!to) return _mcpNo('A group needs a name.');
  const other = mcpLibGroup(_mcpPictureGroups(), to);
  if (other && other.key !== g.key) return _mcpNo('There is already a picture group called "' + to + '". Pick another name.');
  const before = galleryLayoutNow();
  galleryCommit(libRenameGroup(before, g.key, to));
  return mcpDone('renamed the picture group "' + g.name + '" to "' + to + '"', _mcpPicturesBack(before), 'Renamed the picture group "' + g.name + '" to "' + to + '".');
}

function _mcpDeletePictureGroup(args) {
  const g = mcpLibGroup(_mcpPictureGroups(), args.name);
  if (!g) return _mcpNo('No picture group is called "' + (args.name || '') + '". list_gallery shows the groups.');
  const before = galleryLayoutNow();
  galleryCommit(libUngroup(before, g.key));
  return mcpDone('ungrouped the picture group "' + g.name + '"', _mcpPicturesBack(before), 'The picture group "' + g.name + '" is gone; its pictures are in no group now. No picture was deleted.');
}

async function _mcpAddPicture(args) {
  const read = await window.electronAPI.readMapFiles(String(args.path || ''), { only: 'image' });
  if (read.error) return _mcpNo(read.error);
  const images = read.files;
  if (!images.length) return _mcpNo('Pictures holds images, and no image was found at that path.');
  const added = [], failed = [];
  for (const f of images) {
    const p = await galleryAddFile(new File([f.bytes], f.name, { type: f.type }));
    if (p) added.push(p); else failed.push('"' + f.name + '" would not open as a picture.');
  }
  if (!added.length) return _mcpNo('Nothing was added. ' + failed.join(' '));
  if (args.name && added.length === 1) galleryRenameTo(added[0].id, String(args.name).trim() || added[0].name);
  const now = added.map(p => '"' + galleryList().find(x => x.id === p.id).name + '"');
  const left = [...failed, ...read.skipped.map(s => '"' + s.name + '" ' + s.reason)];
  return mcpDone('added ' + now.join(', ') + ' to Pictures', async () => {
    if (added.some(p => galleryOnTv(p.id))) throw Object.assign(new Error('Not undone: the TV shows a picture Claude added. Ask the DM to take it down first.'), { mcpKeep: true });
    for (const p of added) await galleryDrop(p.id);
  },
    'Added ' + now.join(', ') + ' to Pictures. Nothing was shown on the TV.' + (left.length ? ' Left out: ' + left.join(' ') : ''));
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
  if (args.confirmed !== true) return _mcpOk(mcpWouldDelete('picture', { name: found.pic.name }));
  const kept = await galleryDrop(id);
  return mcpDone('deleted the picture "' + found.pic.name + '"', () => galleryRestore(kept), 'Deleted the picture "' + found.pic.name + '".');
}

const MCP_GALLERY_TOOLS = { list_gallery: _mcpListGallery, add_picture: _mcpAddPicture, rename_picture: _mcpRenamePicture, delete_picture: _mcpDeletePicture,
  set_picture_group: _mcpSetPictureGroup, create_picture_group: _mcpCreatePictureGroup, rename_picture_group: _mcpRenamePictureGroup,
  delete_picture_group: _mcpDeletePictureGroup };
