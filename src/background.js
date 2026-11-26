/**
 * ============================================================================
 * RSSext - Service Worker (GPL-3.0)
 * ============================================================================
 * RÔLE :
 * 1. Gestion du cycle de vie (Alarme de synchronisation).
 * 2. Scan des sources en arrière-plan via fetch + regex.
 * 3. Orchestration des notifications système.
 * 4. Nettoyage automatique du buffer (TTL).
 * ============================================================================
 */

import { DB } from "./db.js";
import { decodeEntities, addRef, formatTimeAgo, t } from "./utils.js";

// Configuration 
const DEFAULT_INTERVAL_RANGE = "15-30";
const DEFAULT_TTL = 30;
const SCAN_BATCH_SIZE = 5;
const SAME_HOST_DELAY_MIN_MS = 600;
const SAME_HOST_DELAY_MAX_MS = 1400;
const LEGACY_INTERVAL_MAP = {
  5: "0-5",
  15: "5-15",
  30: "15-30",
  60: "30-60",
  120: "60-120",
  720: "120-720",
  1440: "720-1440",
};
let isScanning = false;
let scanAbortController = null;

/**
 * Parse une chaîne d'intervalle ('min-max') ou une ancienne valeur numérique en bornes (minutes).
 * @param {string|number} rawInterval
 * @returns {{ minMinutes: number, maxMinutes: number }}
 */
function parseIntervalRange(rawInterval) {
  const normalized = LEGACY_INTERVAL_MAP[rawInterval] || String(rawInterval || DEFAULT_INTERVAL_RANGE);
  const parts = normalized.split("-").map((n) => parseInt(n, 10));
  if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    const minMinutes = Math.max(0, Math.min(parts[0], parts[1]));
    const maxMinutes = Math.max(minMinutes, parts[0], parts[1]);
    return { minMinutes, maxMinutes };
  }
  return { minMinutes: 15, maxMinutes: 30 };
}

/**
 * Calcule un prochain timestamp de scan aléatoire dans l'intervalle donné.
 * @param {{ minMinutes: number, maxMinutes: number }} range
 * @returns {number}
 */
function computeNextScanAt({ minMinutes, maxMinutes }) {
  const minMs = Math.max(15000, minMinutes * 60 * 1000);
  const maxMs = Math.max(minMs, maxMinutes * 60 * 1000);
  const delayMs = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  return Date.now() + delayMs;
}

/**
 * Crée ou maintient l'alarme périodique de vérification (1 minute).
 */
function ensureScanAlarm() {
  chrome.alarms.create("rss-scan-alarm", { periodInMinutes: 1 });
}

/**
 * INITIALISATION
 * Se déclenche à l'installation ou lors d'une mise à jour.
 */
chrome.runtime.onInstalled.addListener(async () => {
  ensureScanAlarm();
  performScan({ mode: "all" });
});

/**
 * AU DÉMARRAGE DU NAVIGATEUR
 * Lance un scan immédiat pour rafraîchir les données.
 */
chrome.runtime.onStartup.addListener(() => {
  ensureScanAlarm();
  performScan({ mode: "due" });
});

/**
 * ÉCOUTEUR D'ALARME
 * Réveille le worker pour lancer le processus de scan.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "rss-scan-alarm") {
    performScan({ mode: "due" });
  } else if (alarm.name.startsWith("retry:")) {
    // Gestion du retry notification (après 15 min)
    const itemId = alarm.name.split(":")[1];

    // Vérification des préférences globales au moment du retry
    const config = await chrome.storage.local.get(["notify"]);
    if (config.notify === false) return;

    const items = await DB.getItems();
    const item = items.find((i) => i.id === itemId);
    // On ne relance que si l'item existe encore et n'est pas caché
    if (item) {
      // On doit retrouver la source pour l'affichage
      const sources = await DB.getSources();
      const source = sources.find((s) => s.xmlUrl === item.xmlUrl);
      if (source) {
        // Vérification que la source est toujours notifiable
        if (source.notify) {
          NotificationSystem.enqueue(item, source, 2); // Tentative 2
        }
      }
    }
  }
  }
);

/**
 * Extrait le nom d'hôte d'une URL pour la sérialisation par domaine.
 * @param {string} url
 * @returns {string}
 */
function getHostname(url) {
  try {
    return new URL(url).hostname || "unknown";
  } catch (e) {
    return "unknown";
  }
}

/**
 * Attend un délai en millisecondes, interruptible immédiatement via AbortSignal.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function delayWithAbort(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timerId);
      resolve();
    };
    const timerId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Exécute des tâches en parallèle avec au plus 1 requête active par domaine
 * et un délai aléatoire entre deux requêtes vers le même domaine.
 * @param {Array} sources
 * @param {Function} worker
 * @param {number} maxConcurrency
 * @param {AbortSignal} [signal]
 */
async function runDomainAwareScan(sources, worker, maxConcurrency = SCAN_BATCH_SIZE, signal = null) {
  const queues = new Map();
  for (const src of sources) {
    const host = getHostname(src.xmlUrl);
    if (!queues.has(host)) queues.set(host, []);
    queues.get(host).push(src);
  }

  const hostEntries = Array.from(queues.values());
  let cursor = 0;

  async function processHostQueue() {
    while (cursor < hostEntries.length) {
      if (signal && signal.aborted) return;
      const queue = hostEntries[cursor++];
      for (let i = 0; i < queue.length; i++) {
        if (signal && signal.aborted) return;
        await worker(queue[i]);
        if (signal && signal.aborted) return;
        if (i < queue.length - 1) {
          const jitter =
            SAME_HOST_DELAY_MIN_MS +
            Math.floor(Math.random() * (SAME_HOST_DELAY_MAX_MS - SAME_HOST_DELAY_MIN_MS + 1));
          await delayWithAbort(jitter, signal);
        }
      }
    }
  }

  const workerCount = Math.min(maxConcurrency, hostEntries.length);
  await Promise.all(Array.from({ length: workerCount }, () => processHostQueue()));
}

/**
 * Récupère et traite une source individuelle, puis planifie son prochain scan aléatoire.
 */
async function scanSingleSource(source, { ttl, notifyEnabled, existingIds, intervalRange, scanSignal }) {
  if (scanSignal && scanSignal.aborted) return;

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10000);

  const onScanAbort = () => controller.abort();
  if (scanSignal) {
    scanSignal.addEventListener("abort", onScanAbort, { once: true });
  }

  let wasAbortedByUser = false;

  try {
    const response = await fetch(source.xmlUrl, { cache: "no-store", signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xmlText = await response.text();
    if (scanSignal && scanSignal.aborted) {
      wasAbortedByUser = true;
      return;
    }

    const parsedItems = parseFeed(xmlText, source.xmlUrl, ttl);
    const freshItems = parsedItems
      .filter((item) => matchesSourceFilter(item, source.filter))
      .map(({ _filterMeta, ...dbItem }) => dbItem);
    const siteUrl = extractSiteUrl(xmlText, source.xmlUrl);

    const newItems = freshItems.filter((item) => {
      if (!existingIds.has(item.id)) {
        existingIds.add(item.id);
        return true;
      }
      return false;
    });

    if (newItems.length > 0) {
      await DB.addItems(newItems);
      if (source.notify && notifyEnabled) {
        newItems.forEach((item) => {
          NotificationSystem.enqueue(item, source, 1);
        });
      }
    }

    const hasSameSiteUrl = source.siteUrl && isSameUrl(source.siteUrl, source.xmlUrl);
    if ((!source.siteUrl || hasSameSiteUrl) && siteUrl) {
      source.siteUrl = siteUrl;
    } else if (hasSameSiteUrl) {
      delete source.siteUrl;
    }
    if (source.error) {
      delete source.error;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (scanSignal && scanSignal.aborted && !timedOut) {
      wasAbortedByUser = true;
      return;
    }
    const normalizedErr = err.name === "AbortError" ? new Error("Timeout (10s)") : err;
    console.warn(`RSSext: Failed to scan ${source.xmlUrl}`, normalizedErr);
    source.error = normalizedErr.message || "Unknown error";
  } finally {
    clearTimeout(timeoutId);
    if (scanSignal) {
      scanSignal.removeEventListener("abort", onScanAbort);
    }
    if (!wasAbortedByUser) {
      source.nextScanAt = computeNextScanAt(intervalRange);
      await DB.putSource(source);
    }
  }
}

/**
 * LOGIQUE DE SCAN PRINCIPALE
 * @param {Object} options - Options de scan ({ mode: 'all'|'due'|'failed'|'single', xmlUrl?: string }).
 */
async function performScan(options = {}) {
  const { mode = "all", xmlUrl = null } = options;
  if (!navigator.onLine) return;
  
  // Si un scan est déjà en cours, on annule l'exécution silencieusement
  if (isScanning) return; 
  isScanning = true;
  scanAbortController = new AbortController();
  const scanSignal = scanAbortController.signal;
  chrome.runtime.sendMessage({ action: "scan_started", mode, xmlUrl }).catch(() => {});

  try {
    // Récupération de la config
    const config = await chrome.storage.local.get(["ttl", "notify", "interval"]);
    const ttl = parseInt(config.ttl, 10) || DEFAULT_TTL;
    const intervalRange = parseIntervalRange(config.interval);
    const notifyEnabled = config.notify !== false;

    // 1. Purge du buffer (TTL) avant de commencer
    await DB.purgeOldItems(ttl);
    await updateBadge();

    // 2. Récupération des sources et des items existants (une seule fois)
    const allSources = await DB.getSources();
    const now = Date.now();
    let sources = allSources;
    if (mode === "due") {
      sources = allSources.filter((s) => !s.nextScanAt || s.nextScanAt <= now);
    } else if (mode === "failed") {
      sources = allSources.filter((s) => Boolean(s.error));
    } else if (mode === "single" && xmlUrl) {
      sources = allSources.filter((s) => s.xmlUrl === xmlUrl);
    }

    if (sources.length === 0) return;

    const existingItems = await DB.getAllItems();
    const existingIds = new Set(existingItems.map((i) => i.id));

    // 3. Traitement sérialisé par domaine avec jitter aléatoire
    await runDomainAwareScan(
      sources,
      (source) => scanSingleSource(source, { ttl, notifyEnabled, existingIds, intervalRange, scanSignal }),
      SCAN_BATCH_SIZE,
      scanSignal
    );
    await updateBadge();
  } catch (err) {
    console.error("RSSext: Scan process failed", err);
  } finally {
    // On libère le verrou quoi qu'il arrive (succès ou erreur)
    const aborted = Boolean(scanAbortController && scanAbortController.signal.aborted);
    scanAbortController = null;
    isScanning = false;
    chrome.runtime.sendMessage({ action: "scan_finished", mode, xmlUrl, aborted }).catch(() => {});
  }
}

/**
 * Vérifie si un extrait texte correspond à un flux RSS/Atom/RDF XML.
 * @param {string} text - Début du document récupéré.
 * @returns {boolean}
 */
function isFeedXml(text) {
  if (!text) return false;
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  if (/^<!doctype\s+html\b|^<html[\s>]/i.test(trimmed)) return false;
  return /<(?:rss|feed|rdf:RDF)(?:\s|>)/i.test(trimmed);
}

/**
 * Extrait le titre du flux depuis l'en-tête XML (RSS/Atom).
 * @param {string} xmlString - Contenu XML (ou extrait d'en-tête).
 * @returns {string}
 */
function extractFeedTitle(xmlString) {
  if (!xmlString) return "";
  const headerMatch = xmlString.match(/^[\s\S]*?(?=<(?:item|entry)[\s>])/i);
  const header = headerMatch ? headerMatch[0] : xmlString;
  const titleMatch = header.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  return titleMatch ? decodeEntities(titleMatch[1].trim()).replace(/\s+/g, " ") : "";
}

/**
 * Lit au maximum `maxBytes` d'une Response pour valider un flux sans télécharger tout le fichier.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
async function readResponseHead(response, maxBytes = 65536) {
  if (!response.body || typeof response.body.getReader !== "function") {
    return (await response.text()).slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let result = "";
  let totalBytes = 0;

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      result += decoder.decode(value, { stream: true });
      if (/<(?:item|entry)[\s>]/i.test(result)) break;
    }
    result += decoder.decode();
  } finally {
    reader.cancel().catch(() => {});
  }
  return result;
}

/**
 * Valide qu'une URL pointe réellement vers un flux RSS/Atom accessible.
 * @param {string} rawUrl
 * @param {number} timeoutMs
 * @returns {Promise<{valid: boolean, url?: string, title?: string}>}
 */
async function validateFeedUrl(rawUrl, timeoutMs = 5000) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false };
    }
  } catch (e) {
    return { valid: false };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(rawUrl, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!response.ok) return { valid: false };

    const headText = await readResponseHead(response);
    if (!isFeedXml(headText)) return { valid: false };

    return {
      valid: true,
      url: response.url || rawUrl,
      title: extractFeedTitle(headText),
    };
  } catch (e) {
    return { valid: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extrait l'URL du site web depuis l'en-tête du flux RSS/Atom.
 * @param {string} xmlString - Le contenu XML brut.
 * @param {string} xmlUrl - L'URL du flux (pour résoudre les liens relatifs).
 * @returns {string|null} L'URL du site ou null.
 */
function isSameUrl(a, b) {
  try {
    return new URL(a).toString() === new URL(b).toString();
  } catch (e) {
    return a === b;
  }
}

function extractSiteUrl(xmlString, xmlUrl) {
  const headerMatch = xmlString.match(/^[\s\S]*?(?=<(?:item|entry)[\s>])/i);
  const header = headerMatch ? headerMatch[0] : xmlString;

  const candidates = [];
  const rssLinkMatch = header.match(/<link(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
  if (rssLinkMatch && rssLinkMatch[1].trim()) {
    candidates.push(rssLinkMatch[1].trim());
  }

  const atomLinks = header.match(/<link[^>]+>/gi) || [];
  let fallbackAtom = "";
  for (const linkTag of atomLinks) {
    if (/rel=["']self["']/i.test(linkTag)) continue;
    if (/type=["'][^"']*(?:rss|atom|rdf|xml)[^"']*["']/i.test(linkTag)) continue;
    const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
    if (hrefMatch) {
      const href = hrefMatch[1].trim();
      if (/rel=["']alternate["']/i.test(linkTag)) {
        candidates.push(href);
        break;
      }
      if (!fallbackAtom) fallbackAtom = href;
    }
  }
  if (fallbackAtom) candidates.push(fallbackAtom);

  for (let rawLink of candidates) {
    rawLink = decodeEntities(rawLink);
    try {
      const urlObj = new URL(rawLink, xmlUrl);
      if (
        (urlObj.protocol === "http:" || urlObj.protocol === "https:") &&
        !isSameUrl(urlObj.toString(), xmlUrl)
      ) {
        return urlObj.toString();
      }
    } catch (e) {
      // URL invalide ignorée
    }
  }
  return null;
}

/**
 * Parse une chaîne de règles (séparées par virgule ou saut de ligne) en prédicats.
 * Supporte le format /regex/flags (insensible à la casse par défaut).
 * @param {string} rawRules
 * @returns {Array<(text: string) => boolean>}
 */
function parseFilterRules(rawRules) {
  if (!rawRules || typeof rawRules !== "string") return [];
  return rawRules
    .split(/[\r\n,，]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const regexMatch = token.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regexMatch) {
        try {
          const flags = regexMatch[2].includes("i") ? regexMatch[2] : `${regexMatch[2]}i`;
          const re = new RegExp(regexMatch[1], flags.replace(/g/g, ""));
          return (text) => re.test(text);
        } catch (e) {
          // Regex invalide : repli sur une correspondance texte simple
        }
      }
      const needle = token.toLowerCase();
      return (text) => text.toLowerCase().includes(needle);
    });
}

/**
 * Vérifie si un article correspond aux règles de filtrage d'une source.
 * @param {Object} item - Article parsé (avec _filterMeta).
 * @param {{include?: string, exclude?: string, matchContent?: boolean}|undefined} filter
 * @returns {boolean}
 */
function matchesSourceFilter(item, filter) {
  if (!filter) return true;
  const includeRules = parseFilterRules(filter.include);
  const excludeRules = parseFilterRules(filter.exclude);
  if (includeRules.length === 0 && excludeRules.length === 0) return true;

  const meta = item._filterMeta || {};
  const parts = [item.title || "", meta.categories || "", item.link || ""];
  if (filter.matchContent && meta.summary) {
    parts.push(meta.summary);
  }
  const haystack = parts.join("\n");

  if (includeRules.length > 0 && !includeRules.some((fn) => fn(haystack))) {
    return false;
  }
  if (excludeRules.length > 0 && excludeRules.some((fn) => fn(haystack))) {
    return false;
  }
  return true;
}

/**
 * Extrait les métadonnées textuelles d'un bloc <item>/<entry> pour le filtrage.
 * @param {string} block
 * @returns {{categories: string, summary: string}}
 */
function extractItemFilterMeta(block) {
  const categories = [];
  const catTags = block.match(/<category(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/category>)/gi) || [];
  for (const tag of catTags) {
    const termMatch = tag.match(/term=["']([^"']+)["']/i);
    if (termMatch && termMatch[1].trim()) {
      categories.push(decodeEntities(termMatch[1].trim()));
      continue;
    }
    const innerMatch = tag.match(/>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/i);
    if (innerMatch && innerMatch[1].trim()) {
      categories.push(decodeEntities(innerMatch[1].trim()));
    }
  }

  let rawSummary = "";
  const summaryMatch = block.match(
    /<(?:content:encoded|description|summary|content)(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:content:encoded|description|summary|content)>/i,
  );
  if (summaryMatch && summaryMatch[1]) {
    rawSummary = decodeEntities(summaryMatch[1])
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    categories: categories.join(" "),
    summary: rawSummary,
  };
}

/**
 * PARSER LIGHT (Regex)
 * Extrait Titre et URL sans utiliser le DOM.
 * @param {string} xmlString - Le contenu XML brut.
 * @param {string} xmlUrl - L'URL de la source (pour le contexte).
 * @param {number} ttl - Durée de vie en jours.
 * @returns {Array} Liste des articles trouvés.
 */
function parseFeed(xmlString, xmlUrl, ttl = 30) {
  const items = [];
  const now = Date.now();
  const threshold = now - ttl * 24 * 60 * 60 * 1000;

  const blocks = xmlString.match(/<(item|entry)[\s\S]*?<\/\1>/g) || [];

  for (const block of blocks) {
    // 1. Extraction de la date (pubDate pour RSS, updated/published pour Atom)
    const dateMatch = block.match(
      /<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/,
    );
    const pubDate = dateMatch ? new Date(dateMatch[2]).getTime() : now;

    // 2. Si l'article est plus vieux que le buffer, on ignore
    if (pubDate < threshold) continue;

    // 3. Extraction Titre et Lien
    const titleMatch = block.match(
      /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/,
    );
    let title = titleMatch ? titleMatch[1].trim() : chrome.i18n.getMessage("item_no_title");
    title = decodeEntities(title);

    let link = "";
    const rssLinkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    
    if (rssLinkMatch) {
      // Stratégie RSS 2.0 classique
      link = rssLinkMatch[1].trim();
    } else {
      // Stratégie Atom : on récupère toutes les balises <link> de l'entrée
      const atomLinks = block.match(/<link[^>]+>/ig) || [];
      
      for (const linkTag of atomLinks) {
        // Règle n°1 : On ignore strictement les liens qui pointent vers le flux lui-même
        if (/rel=["']self["']/i.test(linkTag)) {
          continue;
        }

        const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
        if (hrefMatch) {
          link = hrefMatch[1];
          
          // Règle n°2 : Si on trouve un alternate explicite, c'est le vainqueur absolu.
          if (/rel=["']alternate["']/i.test(linkTag)) {
            break; 
          }
          // Note : S'il n'y a pas d'attribut 'rel', on stocke le href (Atom suppose que c'est l'alternate par défaut),
          // mais on laisse la boucle continuer au cas où un vrai alternate plus qualitatif se cache plus loin.
        }
      }
    }

    if (link) {
      link = decodeEntities(link);
      try {
        const urlObj = new URL(link);
        // On refuse tout ce qui n'est pas strictement du HTTP(S)
        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
           continue; // On rejette ce lien empoisonné ou invalide
        }
        // Liste noire des paramètres de tracking les plus toxiques/courants
        const trackingParams = [
          "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", 
          "fbclid", // Facebook
          "gclid",  // Google Ads
          "igshid", // Instagram
          "si"      // YouTube Share ID (souvent ajouté récemment)
        ];
        trackingParams.forEach(param => urlObj.searchParams.delete(param));
        link = urlObj.toString();
      } catch (e) {
        // L'URL est malformée ou relative (ex: "/article/1").
        // On la laisse telle quelle plutôt que de crasher le parser entier.
      }

      // On encode l'URL pour générer l'ID
      const id = btoa(encodeURIComponent(link)).replace(/=/g, '');
      items.push({
        id,
        xmlUrl,
        title,
        link,
        timestamp: pubDate,
        _filterMeta: extractItemFilterMeta(block),
      }); // On stocke la vraie date !
    }
  }
  return items;
}

/**
 * SYSTÈME DE NOTIFICATIONS AVANCÉ
 * Gère la queue, le throttling, les interactions et le retry.
 */
const NotificationSystem = {
  queue: [],
  isProcessing: false,
  handledIds: new Set(), // IDs traités par l'utilisateur (clic/close) pour éviter le retry

  /**
   * Vide la file d'attente.
   */
  clear() {
    this.queue = [];
  },

  /**
   * Ajoute une notification à la file d'attente.
   */
  enqueue(item, source, attempt = 1) {
    // Vérifie si l'article (pour la même tentative) est déjà dans la file
    const alreadyQueued = this.queue.some(
      q => q.item.id === item.id && q.attempt === attempt
    );

    if (!alreadyQueued) {
      this.queue.push({ item, source, attempt });
      this.processQueue();
    }
  },

  /**
   * Traite la file d'attente avec un throttling
   */
  processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const { item, source, attempt } = this.queue.shift();

    DB.getItems().then((items) => {
      const dbItem = items.find((i) => i.id === item.id);
      if (dbItem) {
        this.show(item, source, attempt);
      }
    }).finally(() => {
      // 2. Définition et bascule du délai
      const currentDelay = this.useLongDelay ? 3000 : 2800;
      this.useLongDelay = !this.useLongDelay; // On inverse pour le prochain passage

      // 3. Application du délai calculé
      setTimeout(() => {
        this.isProcessing = false;
        this.processQueue();
      }, currentDelay);
    });
  },

  /**
   * Affiche la notification native.
   */
  show(item, source, attempt) {
    // Calcul de l'âge pour le contexte
    const age = formatTimeAgo(item.timestamp);
    const category = source.folder || t("folder_general");

    // ID unique pour la notif, mais on garde l'ID de l'item pour la logique
    // Format: "item_id:attempt:timestamp"
    // Le timestamp garantit une nouvelle notif visuelle à chaque fois (pas d'update)
    const notifId = `${item.id}:${attempt}:${Date.now()}`;

    chrome.notifications.create(notifId, {
      type: "basic",
      iconUrl: "/assets/icon128.png",
      title: item.title,
      message: source.title,
      contextMessage: `${category} • (${age})`,
      buttons: [
        { title: chrome.i18n.getMessage("action_open") },
        { title: chrome.i18n.getMessage("action_discard") },
      ],
      priority: 2,
      requireInteraction: true, // On force l'affichage jusqu'au clear()
    });

    // Auto-clear après 30 secondes -> Déclenche onClosed
    setTimeout(() => {
      chrome.notifications.clear(notifId);
    }, 30000);
  },
};

/**
 * GESTION DES CLICS SUR NOTIFICATIONS (Corps)
 * Action : Ouvrir + Cacher
 */
chrome.notifications.onClicked.addListener(async (notifId) => {
  const [itemId] = notifId.split(":");
  NotificationSystem.handledIds.add(notifId); // Marqué comme traité

  const items = await DB.getAllItems();
  const item = items.find((i) => i.id === itemId);
  
  if (item) {
    await DB.setItemRead(itemId, true);
    updateBadge();
    chrome.runtime.sendMessage({ action: "set_item_read_ui", itemId: itemId, read: true }).catch(() => {});
    chrome.tabs.create({ url: addRef(item.link) });
  }
  chrome.notifications.clear(notifId);
});

/**
 * GESTION DES BOUTONS (0: Open, 1: Discard)
 */
chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  const [itemId] = notifId.split(":");
  NotificationSystem.handledIds.add(notifId); // Marqué comme traité
  chrome.notifications.clear(notifId);

  await DB.setItemRead(itemId, true);
  updateBadge();
  chrome.runtime.sendMessage({ action: "set_item_read_ui", itemId: itemId, read: true }).catch(() => {});

  if (btnIdx === 0) { // OPEN
    const items = await DB.getAllItems();
    const item = items.find((i) => i.id === itemId);
    if (item) {
      chrome.tabs.create({ url: addRef(item.link) });
    }
  }
});

/**
 * GESTION DE LA FERMETURE (Croix ou Timeout)
 */
chrome.notifications.onClosed.addListener((notifId, byUser) => {
  const [itemId, attemptStr] = notifId.split(":");
  const attempt = parseInt(attemptStr, 10);

  // Si fermé par l'utilisateur (la croix), on marque comme lu sans retirer de la liste
  if (byUser) {
    DB.setItemRead(itemId, true).then(() => {
      updateBadge();
      chrome.runtime.sendMessage({ action: "set_item_read_ui", itemId: itemId, read: true }).catch(() => {});
    });
    return;
  }

  // Si fermé par le système (Timeout) ET non traité (pas cliqué avant)
  if (!byUser && !NotificationSystem.handledIds.has(notifId)) {
    // Si c'était la première tentative, on programme le retry dans 15 min
    if (attempt === 1) {
      // console.log(`RSSext: Item ${itemId} ignored. Retrying in 15min.`);
      chrome.alarms.create(`retry:${itemId}`, { delayInMinutes: 15 });
    }
    // Si attempt === 2, on abandonne (supprimé de la queue visuelle, mais reste dans la DB non-caché)
  }

  // Nettoyage mémoire
  NotificationSystem.handledIds.delete(notifId);
});

/**
 * MISE À JOUR DU BADGE
 * Compte les items non cachés et met à jour l'icône.
 */
async function updateBadge() {
  const items = await DB.getItems();
  const count = items.filter((item) => !item.read).length;
  const text = count > 0 ? count.toString() : "";
  chrome.action.setBadgeText({ text });
}

/* AUTRES !!! */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "test_url") {
    // On utilise fetch GET depuis le Service Worker pour éviter CORS et vérifier le contenu XML réel
    validateFeedUrl(request.url)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ valid: false }));
    return true; // Obligatoire pour garder le canal ouvert (asynchrone)
  }

  if (request.action === "probe_feeds") {
    const urls = Array.isArray(request.urls) ? [...new Set(request.urls)].slice(0, 15) : [];
    Promise.allSettled(urls.map((u) => validateFeedUrl(u, 4500)))
      .then((settled) => {
        const seen = new Set();
        const validFeeds = [];
        for (const item of settled) {
          if (item.status === "fulfilled" && item.value.valid) {
            const finalUrl = item.value.url;
            if (!seen.has(finalUrl)) {
              seen.add(finalUrl);
              validFeeds.push({ url: finalUrl, title: item.value.title || "" });
            }
          }
        }
        sendResponse({ feeds: validFeeds });
      })
      .catch(() => sendResponse({ feeds: [] }));
    return true;
  }

  if (request.action === "scan_now") {
    performScan({ mode: request.mode || "all", xmlUrl: request.xmlUrl || null });
  }

  if (request.action === "retry_failed") {
    performScan({ mode: "failed" });
  }

  if (request.action === "scan_source" && request.xmlUrl) {
    performScan({ mode: "single", xmlUrl: request.xmlUrl });
  }

  if (request.action === "cancel_scan") {
    if (isScanning && scanAbortController) {
      scanAbortController.abort();
    }
  }

  if (request.action === "get_scan_status") {
    sendResponse({ isScanning });
  }

  if (request.action === "update_settings") {
    // Interruption immédiate des notifications en cours
    NotificationSystem.clear();
    ensureScanAlarm();

    // Réappliquer le nouvel intervalle aléatoire sur les sources existantes
    chrome.storage.local.get(["interval"], async (res) => {
      const range = parseIntervalRange(res.interval);
      const sources = await DB.getSources();
      for (const s of sources) {
        s.nextScanAt = computeNextScanAt(range);
        await DB.putSource(s);
      }
    });
    // On lance aussi un scan immédiat pour appliquer le nouveau TTL
    performScan({ mode: "all" });
  }
});
