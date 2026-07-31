/**
 * 域名管理模块
 * @module modules/app/domains
 */

import { cacheGet, cacheSet, readPrefetch } from '../../storage.js';
import { isGuest } from './session.js';

// 域名列表
let domains = [];

// 存储键
export const STORAGE_KEYS = {
  domain: 'mailfree:lastDomain',
  length: 'mailfree:lastLen',
  subdomain: 'mailfree:lastSubdomain'
};

/**
 * 获取域名列表
 * @returns {Array}
 */
export function getDomains() {
  return domains;
}

/**
 * 设置域名列表
 * @param {Array} list - 域名列表
 */
export function setDomains(list) {
  domains = Array.isArray(list) ? list : [];
}

/**
 * 规范化域名为统一对象格式
 * @param {*} d - 域名项（字符串或对象）
 * @returns {{domain:string, wildcard:boolean}}
 */
function normalizeDomainEntry(d) {
  if (typeof d === 'string') {
    return { domain: d, wildcard: false };
  }
  return { domain: d.domain || '', wildcard: !!d.wildcard };
}

/**
 * 填充域名下拉框
 * @param {Array} domainList - 域名列表
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 */
export function populateDomains(domainList, selectElement) {
  if (!selectElement) return;
  const list = Array.isArray(domainList) ? domainList : [];
  // 兼容字符串数组和对象数组
  setDomains(list.map(normalizeDomainEntry));
  
  selectElement.innerHTML = list.map((d, i) => {
    const entry = normalizeDomainEntry(d);
    const label = entry.wildcard ? `*.${entry.domain}` : entry.domain;
    return `<option value="${i}" data-wildcard="${entry.wildcard}">${label}</option>`;
  }).join('');
  
  const stored = localStorage.getItem(STORAGE_KEYS.domain) || '';
  const idx = stored ? list.findIndex(d => normalizeDomainEntry(d).domain === stored) : -1;
  selectElement.selectedIndex = idx >= 0 ? idx : 0;
  
  selectElement.addEventListener('change', () => {
    const opt = selectElement.options[selectElement.selectedIndex];
    if (opt) {
      const entry = normalizeDomainEntry(list[selectElement.selectedIndex]);
      localStorage.setItem(STORAGE_KEYS.domain, entry.domain);
      updateSubdomainInputVisibility(selectElement, list);
    }
  }, { once: true });
  
  // 初始检查子域名输入框可见性
  updateSubdomainInputVisibility(selectElement, list);
}

/**
 * 根据当前选中的域名更新子域名输入框的可见性
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 * @param {Array} list - 域名列表
 */
function updateSubdomainInputVisibility(selectElement, list) {
  const subdomainInput = document.getElementById('subdomain-input');
  if (!subdomainInput || !selectElement) return;
  
  const idx = selectElement.selectedIndex;
  if (idx < 0 || idx >= list.length) {
    subdomainInput.style.display = 'none';
    return;
  }
  
  const entry = normalizeDomainEntry(list[idx]);
  subdomainInput.style.display = entry.wildcard ? 'block' : 'none';
  
  // 恢复上次输入的子域名
  if (entry.wildcard) {
    const stored = localStorage.getItem(STORAGE_KEYS.subdomain) || '';
    subdomainInput.value = stored;
    subdomainInput.oninput = () => {
      localStorage.setItem(STORAGE_KEYS.subdomain, subdomainInput.value.trim());
    };
  }
}

/**
 * 从 API 加载域名列表
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 * @param {Function} api - API 函数
 */
export async function loadDomains(selectElement, api) {
  if (isGuest()) {
    populateDomains(['example.com'], selectElement);
    return;
  }
  
  let domainSet = false;
  
  // 尝试从缓存加载
  try {
    const cached = cacheGet('domains', 24 * 60 * 60 * 1000);
    if (Array.isArray(cached) && cached.length) {
      populateDomains(cached, selectElement);
      domainSet = true;
    }
  } catch(_) {}
  
  // 尝试从预取加载
  try {
    const prefetched = readPrefetch('mf:prefetch:domains');
    if (Array.isArray(prefetched) && prefetched.length) {
      populateDomains(prefetched, selectElement);
      domainSet = true;
    }
  } catch(_) {}
  
  // 从 API 加载
  try {
    const r = await api('/api/domains');
    const domainList = await r.json();
    if (Array.isArray(domainList) && domainList.length) {
      populateDomains(domainList, selectElement);
      cacheSet('domains', domainList);
      domainSet = true;
    }
  } catch(_) {}
  
  // 降级处理
  if (!domainSet) {
    const meta = (document.querySelector('meta[name="mail-domains"]')?.getAttribute('content') || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const fallback = [];
    if (window.currentMailbox && window.currentMailbox.includes('@')) {
      fallback.push(window.currentMailbox.split('@')[1]);
    }
    if (!meta.length && location.hostname) {
      fallback.push(location.hostname);
    }
    const list = [...new Set(meta.length ? meta : fallback)].filter(Boolean);
    populateDomains(list, selectElement);
  }
}

/**
 * 获取存储的长度
 * @returns {number}
 */
export function getStoredLength() {
  const stored = Number(localStorage.getItem(STORAGE_KEYS.length) || '8');
  return Math.max(8, Math.min(30, isNaN(stored) ? 8 : stored));
}

/**
 * 保存长度
 * @param {number} length - 长度
 */
export function saveLength(length) {
  const clamped = Math.max(8, Math.min(30, isNaN(length) ? 8 : length));
  localStorage.setItem(STORAGE_KEYS.length, String(clamped));
}

/**
 * 获取选中的域名索引
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 * @returns {number}
 */
export function getSelectedDomainIndex(selectElement) {
  return Number(selectElement?.value || 0);
}

/**
 * 获取选中的完整域名（含子域名前缀，如有）
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 * @returns {string} 完整域名，如 "red.599.chat" 或 "798.cc.cd"
 */
export function getSelectedDomain(selectElement) {
  const list = getDomains();
  const idx = getSelectedDomainIndex(selectElement);
  const entry = list[idx] || list[0];
  if (!entry) return '';
  
  const baseDomain = entry.domain;
  if (entry.wildcard) {
    const subdomainInput = document.getElementById('subdomain-input');
    const sub = (subdomainInput?.value || '').trim().toLowerCase();
    if (sub && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(sub)) {
      return `${sub}.${baseDomain}`;
    }
  }
  return baseDomain;
}

/**
 * 更新范围滑块进度
 * @param {HTMLInputElement} input - 滑块元素
 */
export function updateRangeProgress(input) {
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const val = Number(input.value || min);
  const percent = ((val - min) * 100) / (max - min);
  input.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--border-light) ${percent}%)`;
}

export default {
  getDomains,
  setDomains,
  populateDomains,
  loadDomains,
  getStoredLength,
  saveLength,
  getSelectedDomainIndex,
  getSelectedDomain,
  updateRangeProgress,
  STORAGE_KEYS
};
