import { openDB } from 'idb';

const DB_NAME = 'createpdf-db';
const DB_VERSION = 1;
const DATA_STORES = ['recent-files', 'starred-tools', 'preferences', 'documents', 'gst-invoices',
  'gst-profiles', 'pos-products', 'pos-bills', 'pos-settings', 'workflows',
  'resume-data', 'whiteboards'];

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

export async function getDocuments() {
  const db = await getDb();
  const documents = await db.getAll('documents');
  return documents.sort((left, right) => (right.savedAt || 0) - (left.savedAt || 0));
}

export async function renameDocument(id, name) {
  const db = await getDb();
  const document = await db.get('documents', id);
  if (!document) throw new Error('Saved document not found.');
  await db.put('documents', { ...document, name: name.trim() || document.name, savedAt: Date.now() });
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

export async function savePosProducts(products) {
  const db = await getDb();
  const transaction = db.transaction('pos-products', 'readwrite');
  await Promise.all([...products.map(product => transaction.store.put(product)), transaction.done]);
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
  const resumes = await db.getAll('resume-data');
  return resumes.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
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

export async function getWhiteboard(id) {
  const db = await getDb();
  return db.get('whiteboards', id);
}

// ===== CLEAR ALL =====
export async function clearAllData() {
  const db = await getDb();
  const tx = db.transaction(DATA_STORES, 'readwrite');
  await Promise.all(DATA_STORES.map((store) => tx.objectStore(store).clear()));
  await tx.done;
}

async function serializeValue(value) {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return { __createPdfType: 'blob', type: value.type, data: btoa(binary) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(serializeValue));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = await serializeValue(item);
    return output;
  }
  return value;
}

async function deserializeValue(value) {
  if (value?.__createPdfType === 'blob') {
    const binary = atob(value.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: value.type || 'application/octet-stream' });
  }
  if (Array.isArray(value)) return Promise.all(value.map(deserializeValue));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = await deserializeValue(item);
    return output;
  }
  return value;
}

export async function exportAppData() {
  const db = await getDb();
  const stores = {};
  for (const store of DATA_STORES) stores[store] = await serializeValue(await db.getAll(store));
  return {
    app: 'CreatePDF.si',
    version: 1,
    exportedAt: new Date().toISOString(),
    stores,
  };
}

export async function importAppData(backup) {
  if (backup?.app !== 'CreatePDF.si' || backup?.version !== 1 || !backup.stores) {
    throw new Error('This is not a supported CreatePDF.si backup.');
  }
  const recordsByStore = {};
  for (const store of DATA_STORES) {
    if (!Array.isArray(backup.stores[store])) throw new Error(`Backup is missing ${store} records.`);
    recordsByStore[store] = await deserializeValue(backup.stores[store]);
  }
  const db = await getDb();
  const tx = db.transaction(DATA_STORES, 'readwrite');
  for (const store of DATA_STORES) {
    const objectStore = tx.objectStore(store);
    await objectStore.clear();
    for (const record of recordsByStore[store]) await objectStore.put(record);
  }
  await tx.done;
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function isStoragePersistent() {
  if (!navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}

// ===== STORAGE ESTIMATE =====
export async function getStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate();
  }
  return { usage: 0, quota: 0 };
}
