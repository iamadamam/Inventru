'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  getState: () => invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  tap: (id, delta) => invoke('tap', id, delta),
  setExact: (id, qty) => invoke('setExact', id, qty),
  setOrdered: (id, v) => invoke('item:ordered', id, v),
  syncNow: () => invoke('syncNow'),
  exportList: () => invoke('list:export'),
  openDashboard: () => invoke('server:openDashboard'),

  connect: (address, code) => invoke('server:connect', address, code),
  useLocal: () => invoke('mode:local'),
  openLocalFolder: () => invoke('local:openFolder'),
  testServer: () => invoke('server:test'),

  pinRequired: (scope = 'edit') => invoke('pin:required', scope),
  unlock: (pin, scope = 'edit') => invoke('settings:unlock', pin, scope),
  lock: (scope) => invoke('settings:lock', scope),

  setField: (id, field, value) => invoke('item:setField', id, field, value),
  setMeta: (id, meta) => invoke('item:setMeta', id, meta),
  addItem: (o) => invoke('item:add', o),
  deleteItem: (id) => invoke('item:delete', id),
  reorder: (ids) => invoke('item:reorder', ids),
  renameCategory: (from, to) => invoke('category:rename', from, to),
  renameSubcategory: (cat, from, to) => invoke('subcategory:rename', cat, from, to),
  setCategoryIcon: (cat, icon) => invoke('category:setIcon', cat, icon),
  addIcon: (name, data) => invoke('icons:add', { name, data }),
  deleteIcon: (id) => invoke('icons:delete', id),
  importList: () => invoke('list:import'),
  resetQuantities: () => invoke('reset:quantities'),
  resetOrdered: () => invoke('reset:ordered'),
  restore: (snap) => invoke('reset:restore', snap),

  settingsGet: () => invoke('settings:get'),
  settingsSave: (payload) => invoke('settings:save', payload),
  setPin: (pin) => invoke('settings:setPin', pin),
});
