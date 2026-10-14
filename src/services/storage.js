import { openDB } from 'idb';

const DB_NAME = 'createpdf-db';
const DB_VERSION = 1;

let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('recent-files')) {
          const rf = db.createObjectStore('recent-files', { keyPath: 'id' });
          rf.createIndex('usedAt', 'usedAt');
        }
        if (!db.objectStoreNames.contains('starred-tools')) {
          db.createObjectStore('starred-tools', { keyPath: 'toolId' });
        }
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('gst-invoices')) {
          const inv = db.createObjectStore('gst-invoices', { keyPath: 'id' });
          inv.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('gst-profiles')) {
          db.createObjectStore('gst-profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pos-products')) {
          const pp = db.createObjectStore('pos-products', { keyPath: 'id' });
          pp.createIndex('category', 'category');
        }
        if (!db.objectStoreNames.contains('pos-bills')) {
          const pb = db.createObjectStore('pos-bills', { keyPath: 'id' });
          pb.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('pos-settings')) {
          db.createObjectStore('pos-settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('workflows')) {
          db.createObjectStore('workflows', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('resume-data')) {
          db.createObjectStore('resume-data', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('whiteboards')) {
          db.createObjectStore('whiteboards', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ===== RECENT FILES =====
export async function addRecentFile(meta) {
  const db = await getDb();
  const record = { ...meta, usedAt: Date.now() };
  await db.put('recent-files', record);
  // Keep only last 20
  const all = await db.getAllFromIndex('recent-files', 'usedAt');
  if (all.length > 20) {
    const toDelete = all.slice(0, all.length - 20);
    const tx = db.transaction('recent-files', 'readwrite');
    for (const item of toDelete) await tx.store.delete(item.id);
    await tx.done;
  }
}

export async function getRecentFiles() {
  const db = await getDb();
  const all = await db.getAllFromIndex('recent-files', 'usedAt');
  return all.reverse();
}

export async function deleteRecentFile(id) {
  const db = await getDb();
  await db.delete('recent-files', id);
}

export async function clearRecentFiles() {
  const db = await getDb();
  await db.clear('recent-files');
}

// ===== STARRED TOOLS =====
export async function starTool(toolId) {
  const db = await getDb();
  await db.put('starred-tools', { toolId, starredAt: Date.now() });
}

export async function unstarTool(toolId) {
  const db = await getDb();
  await db.delete('starred-tools', toolId);
}

export async function getStarredTools() {
  const db = await getDb();
  return db.getAll('starred-tools');
}

export async function isToolStarred(toolId) {
  const db = await getDb();
  return !!(await db.get('starred-tools', toolId));
}

// ===== PREFERENCES =====
export async function getPref(key, defaultValue = null) {
  const db = await getDb();
  const rec = await db.get('preferences', key);
  return rec ? rec.value : defaultValue;
}

export async function setPref(key, value) {
  const db = await getDb();
  await db.put('preferences', { key, value });
}

// ===== DOCUMENTS =====
export async function saveDocument(id, name, blob) {
  const db = await getDb();
  await db.put('documents', { id, name, blob, savedAt: Date.now() });
}

export async function getDocument(id) {
  const db = await getDb();
  return db.get('documents', id);
}

export async function deleteDocument(id) {
  const db = await getDb();
  await db.delete('documents', id);
}

// ===== GST INVOICES =====
export async function saveInvoice(invoice) {
  const db = await getDb();
  await db.put('gst-invoices', invoice);
}

export async function getInvoices() {
  const db = await getDb();
  const all = await db.getAllFromIndex('gst-invoices', 'createdAt');
  return all.reverse();
}

export async function getInvoice(id) {
  const db = await getDb();
  return db.get('gst-invoices', id);
}

export async function deleteInvoice(id) {
  const db = await getDb();
  await db.delete('gst-invoices', id);
}

// ===== GST PROFILES =====
export async function saveProfile(profile) {
  const db = await getDb();
  await db.put('gst-profiles', profile);
}

export async function getProfiles() {
  const db = await getDb();
  return db.getAll('gst-profiles');
}

export async function deleteProfile(id) {
  const db = await getDb();
  await db.delete('gst-profiles', id);
}

// ===== POS PRODUCTS =====
export async function savePosProduct(product) {
  const db = await getDb();
  await db.put('pos-products', product);
}

export async function getPosProducts() {
  const db = await getDb();
  return db.getAll('pos-products');
}

export async function deletePosProduct(id) {
  const db = await getDb();
  await db.delete('pos-products', id);
}

// ===== POS BILLS =====
export async function savePosBill(bill) {
  const db = await getDb();
  await db.put('pos-bills', bill);
}

export async function getPosBills() {
  const db = await getDb();
  const all = await db.getAllFromIndex('pos-bills', 'createdAt');
  return all.reverse();
}

export async function getPosBill(id) {
  const db = await getDb();
  return db.get('pos-bills', id);
}

// ===== POS SETTINGS =====
export async function getPosSetting(key, def = null) {
  const db = await getDb();
  const rec = await db.get('pos-settings', key);
  return rec ? rec.value : def;
}

export async function setPosSetting(key, value) {
  const db = await getDb();
  await db.put('pos-settings', { key, value });
}

// ===== WORKFLOWS =====
export async function saveWorkflow(wf) {
  const db = await getDb();
  await db.put('workflows', wf);
}

export async function getWorkflows() {
  const db = await getDb();
  return db.getAll('workflows');
}

export async function deleteWorkflow(id) {
  const db = await getDb();
  await db.delete('workflows', id);
}

// ===== RESUME =====
export async function saveResume(resume) {
  const db = await getDb();
  await db.put('resume-data', resume);
}

export async function getResumes() {
  const db = await getDb();
  return db.getAll('resume-data');
}

// ===== WHITEBOARDS =====
export async function saveWhiteboard(wb) {
  const db = await getDb();
  await db.put('whiteboards', wb);
}

export async function getWhiteboards() {
  const db = await getDb();
  return db.getAll('whiteboards');
}

// ===== CLEAR ALL =====
export async function clearAllData() {
  const db = await getDb();
  const stores = ['recent-files', 'starred-tools', 'documents', 'gst-invoices',
    'gst-profiles', 'pos-products', 'pos-bills', 'pos-settings', 'workflows',
    'resume-data', 'whiteboards'];
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

// ===== STORAGE ESTIMATE =====
export async function getStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate();
  }
  return { usage: 0, quota: 0 };
}
