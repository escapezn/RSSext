/**
 * ============================================================================
 * RSSext - Interface Popup (GPL-3.0)
 * ============================================================================
 * RÔLE :
 * Gère l'affichage du buffer, l'ajout de sources et l'édition rapide.
 * ============================================================================
 */

import { DB } from "../db.js";
import { t, escapeHtml, formatTimeAgo, addRef, applyZoom, translateUI } from "../utils.js";

// Références DOM
const feedList = document.getElementById("feed-list");
const toggleViewBtn = document.getElementById("toggle-view");
const emptyState = document.getElementById("empty-state");
const addBtn = document.getElementById("add-current");
const dialog = document.getElementById("edit-dialog");
const editForm = dialog.querySelector("form");
const newFolderDialog = document.getElementById("new-folder-dialog");
const openSettingsBtn = document.getElementById("open-settings");
const refreshAllBtn = document.getElementById("refresh-all");
const retryFailedBtn = document.getElementById("retry-failed");
let activeScanState = { scanning: false, mode: null, xmlUrl: null };

// SVG
const SVG_CAT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="icon icon-group-category">
  <line x1="4" y1="4" x2="20" y2="4"></line>
  <line x1="9" y1="7" x2="20" y2="7"></line>
  <line x1="9" y1="10" x2="20" y2="10"></line>
  <line x1="4" y1="13" x2="20" y2="13"></line>
  <line x1="9" y1="16" x2="20" y2="16"></line>
  <line x1="9" y1="19" x2="20" y2="19"></line>
</svg>`;

const SVG_DATE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="icon icon-sort-date">
  <line x1="4" y1="4" x2="20" y2="4"></line>
  <line x1="4" y1="7" x2="18" y2="7"></line>
  <line x1="4" y1="10" x2="16" y2="10"></line>
  <line x1="4" y1="13" x2="14" y2="13"></line>
  <line x1="4" y1="16" x2="12" y2="16"></line>
  <line x1="4" y1="19" x2="10" y2="19"></line>
</svg>`;

const SVG_CHEVRON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-chevron"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

const SVG_EDIT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
const SVG_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const SVG_REFRESH = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;
const SVG_STOP_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-stop"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;

const SVG_CHECK_ALL = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L7 17l-5-5"></path><path d="M22 10l-7.5 7.5L13 16"></path></svg>`;
const SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const SVG_EXPAND = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
const SVG_COLLAPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
const SVG_LIST = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`;
const SVG_ALERT = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

/**
 * INITIALISATION
 */
document.addEventListener("DOMContentLoaded", async () => {
  // Application du thème sauvegardé au démarrage
  chrome.storage.local.get(["hue", "zoom"], (result) => {
    if (result.hue) {
      document.documentElement.style.setProperty("--main-hue", result.hue);
    }
    if (result.zoom) {
      applyZoom(result.zoom);
    }
  });

  translateUI();
  renderApp();

  // Écouteurs de rafraîchissement / retry manuel (et annulation au clic si en cours)
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", () => {
      if (refreshAllBtn.classList.contains("spinning")) {
        chrome.runtime.sendMessage({ action: "cancel_scan" });
        return;
      }
      setScanningUI(true, "all");
      chrome.runtime.sendMessage({ action: "scan_now", mode: "all" });
    });
  }

  if (retryFailedBtn) {
    retryFailedBtn.addEventListener("click", () => {
      if (retryFailedBtn.classList.contains("spinning")) {
        chrome.runtime.sendMessage({ action: "cancel_scan" });
        return;
      }
      setScanningUI(true, "failed");
      chrome.runtime.sendMessage({ action: "retry_failed" });
    });
  }

  chrome.runtime.sendMessage({ action: "get_scan_status" }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.isScanning) {
      setScanningUI(true, "all");
    }
  });

  // Écouteur pour ajouter l'onglet courant
  addBtn.addEventListener("click", detectAndAddFeed);

  if (toggleViewBtn) {
    toggleViewBtn.addEventListener("click", async () => {
      const settings = await chrome.storage.local.get(["view_mode"]);
      const current = settings.view_mode || "date";
      await chrome.storage.local.set({ view_mode: current === "date" ? "folder" : "date" });
      renderApp();
    });
  }

  // Gestion de la fermeture du dialog
  editForm.addEventListener("submit", handleDialogSubmit);

  // Gestion de l'ajout de dossier
  const folderSelect = document.getElementById("edit-folder");
  folderSelect.addEventListener("change", (e) => {
    if (e.target.value === "__NEW__") {
      document.getElementById("new-folder-name").value = "";
      newFolderDialog.showModal();
    }
  });

  newFolderDialog.addEventListener("close", () => {
    if (folderSelect.value === "__NEW__") {
      folderSelect.value = ""; // Revert si annulé
    }
  });

  newFolderDialog.querySelector("form").addEventListener("submit", (e) => {
    if (e.submitter.value === "save") {
      const rawName = document.getElementById("new-folder-name").value;
      const name = rawName.trim(); // Parsing simple
      
      if (name) {
        // Ajout dynamique de l'option
        let opt = Array.from(folderSelect.options).find(o => o.value === name);
        if (!opt) {
          opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          folderSelect.insertBefore(opt, folderSelect.lastElementChild);
        }
        folderSelect.value = name;
      } else {
        folderSelect.value = "";
      }
    }
  });

  // Validation avec Entrée dans le champ texte (évite le Cancel par défaut)
  document.getElementById("new-folder-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      newFolderDialog.querySelector("button[value='save']").click();
    }
  });

  // Validation avec Entrée dans les champs texte du dialog principal
  ['edit-name', 'edit-url', 'edit-site-url'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            dialog.querySelector("button[value='save']").click();
        }
    });
  });

  // --- GESTION DES PARAMÈTRES ---
  openSettingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Bouton supprimer dans l'overlay
  document.getElementById("delete-source").onclick = async () => {
    if (confirm(t("ui_confirm_delete_full"))) {
      await DB.deleteSource(dialog.dataset.currentUrl);
      dialog.close();
      renderApp();
    }
  };
});

/**
 * Affiche les articles du buffer (Vue Date ou Vue Dossier).
 * Gère l'état vide et les boutons d'action contextuels.
 */
async function renderApp() {
  const settings = await chrome.storage.local.get(["view_mode", "collapsed"]);
  const viewMode = settings.view_mode || "date";
  const collapsedState = settings.collapsed || {};

  const items = await DB.getItems();
  const sources = await DB.getSources();
  const unreadItems = items.filter(i => !i.read);

  const hasErrors = sources.some(s => Boolean(s.error));
  if (refreshAllBtn) refreshAllBtn.classList.toggle("hidden", sources.length === 0);
  if (retryFailedBtn) retryFailedBtn.classList.toggle("hidden", !hasErrors);

  // Pré-chargement des couleurs pour les dossiers
  // Optimisation : On résout les couleurs une seule fois ici pour garantir la cohérence
  // entre l'affichage des headers de dossiers et des tags dans les items individuels.
  const uniqueFolders = [...new Set(sources.map(s => s.folder || t("folder_general")))];
  const folderHues = {};
  for (const f of uniqueFolders) {
    if (f !== t("folder_general")) {
      folderHues[f] = await DB.getFolderHue(f);
    } else {
      folderHues[f] = null;
    }
  }

  // --- GESTION DES BOUTONS D'ACTION (Header) ---
  const listActions = document.getElementById("list-actions");
  listActions.innerHTML = "";

  if (viewMode === "folder" && sources.length > 0) {
    // Bouton Expand All
    const btnExpand = document.createElement("button");
    btnExpand.innerHTML = SVG_EXPAND;
    btnExpand.title = t("action_expand_all");
    btnExpand.onclick = () => {
      chrome.storage.local.set({ collapsed: {} });
      renderApp();
    };
    
    // Bouton Show Sources Only (Edit All)
    const btnSources = document.createElement("button");
    btnSources.innerHTML = SVG_LIST;
    btnSources.title = t("action_show_sources");
    btnSources.onclick = () => {
      const sourceCollapsed = {};
      // On replie toutes les sources, mais on laisse les dossiers ouverts (absents de la map)
      sources.forEach(s => sourceCollapsed[`source:${s.xmlUrl}`] = true);
      chrome.storage.local.set({ collapsed: sourceCollapsed });
      renderApp();
    };

    // Bouton Collapse All
    const btnCollapse = document.createElement("button");
    btnCollapse.innerHTML = SVG_COLLAPSE;
    btnCollapse.title = t("action_collapse_all");
    btnCollapse.onclick = () => {
      const allCollapsed = {};
      // On replie tous les dossiers et toutes les sources
      const folders = new Set();
      sources.forEach(s => folders.add(s.folder || t("folder_general")));
      folders.forEach(f => allCollapsed[`folder:${f}`] = true);
      sources.forEach(s => allCollapsed[`source:${s.xmlUrl}`] = true);
      
      chrome.storage.local.set({ collapsed: allCollapsed });
      renderApp();
    };

    listActions.appendChild(btnExpand);
    listActions.appendChild(btnSources);
    listActions.appendChild(btnCollapse);
  } else if (viewMode === "date" && unreadItems.length > 0) {
    // Bouton Mark All as Read
    const btnDismiss = document.createElement("button");
    btnDismiss.id = "mark-all-read";
    btnDismiss.innerHTML = SVG_CHECK_ALL;
    btnDismiss.title = t("action_dismiss_all");
    btnDismiss.onclick = async () => {
      if (confirm(t("ui_confirm_dismiss_all"))) {
        const unreadRows = Array.from(document.querySelectorAll(".item-row:not(.is-read)"));
        const unreadIds = unreadRows.map(r => r.dataset.id).filter(Boolean);
        await DB.setItemsRead(unreadIds, true);
        unreadRows.forEach(row => applyRowReadState(row, true));
        syncUnreadCountersAndBadge();
      }
    };
    listActions.appendChild(btnDismiss);
  }

  if (toggleViewBtn) {
    toggleViewBtn.innerHTML = viewMode === "folder" ? SVG_CAT : SVG_DATE;
    toggleViewBtn.title = viewMode === "folder" ? t("ui_switch_to_date") : t("ui_switch_to_folder");
  }

  const sourceMap = sources.reduce((acc, s) => {
    const folderName = s.folder || t("folder_general");
    acc[s.xmlUrl] = { 
      title: s.title, 
      folder: folderName,
      hue: folderHues[folderName]
    };
    return acc;
  }, {});

  // Mise à jour du badge (uniquement les articles non lus)
  chrome.action.setBadgeText({ text: unreadItems.length > 0 ? unreadItems.length.toString() : "" });

  // Condition d'affichage de l'état vide :
  // - Mode Date : Pas d'articles
  // - Mode Dossier : Pas de sources.
  const showEmptyState = (viewMode === "date" && items.length === 0) || (viewMode === "folder" && sources.length === 0);

  if (showEmptyState) {
    feedList.innerHTML = "";
    emptyState.classList.remove("hidden");

    if (sources.length === 0) {
      // On récupère les SVG directement depuis le DOM (header) pour ne pas les dupliquer en JS
      const iconAdd = addBtn.innerHTML;
      const iconSettings = openSettingsBtn.innerHTML;

      emptyState.innerHTML = `
        <div class="empty-state-content">
          <h2>${t("welcome_title")}</h2>
          <p>${t("welcome_add")}</p>
          <button id="btn-welcome-add" class="primary icon-gap">${iconAdd} ${t("btn_add")}</button>
          <p>${t("welcome_sources")}</p>
          <button id="btn-welcome-options" class="icon-gap">${iconSettings} ${t("btn_options")}</button>
        </div>
      `;
      document.getElementById("btn-welcome-add").onclick = detectAndAddFeed;
      document.getElementById("btn-welcome-options").onclick = () => chrome.runtime.openOptionsPage();
    } else {
      emptyState.textContent = t("ui_no_items");
    }
    return;
  }

  emptyState.classList.add("hidden");

  if (viewMode === "folder") {
    // 1. Initialisation de la structure avec TOUTES les sources
    const structure = {};
    const urlToFolder = {}; // Map pour retrouver le dossier d'un item rapidement

    sources.forEach(s => {
      const f = s.folder || t("folder_general");
      if (!structure[f]) structure[f] = {};
      // On utilise l'URL comme clé unique
      structure[f][s.xmlUrl] = {
        title: s.title,
        url: s.xmlUrl,
        siteUrl: getSourceSiteUrl(s),
        items: [],
        error: s.error
      };
      urlToFolder[s.xmlUrl] = f;
    });

    // 2. Distribution des articles dans la structure
    items.forEach(item => {
      const f = urlToFolder[item.xmlUrl];
      // Si la source existe toujours (n'a pas été supprimée entre temps)
      if (f && structure[f][item.xmlUrl]) {
        structure[f][item.xmlUrl].items.push(item);
      }
    });

    const sortedFolders = Object.keys(structure).sort();

    feedList.innerHTML = sortedFolders.map((folder) => {
      const sourcesInFolder = structure[folder];
      // Tri des sources par titre
      const sortedSourceUrls = Object.keys(sourcesInFolder).sort((a, b) => {
        return sourcesInFolder[a].title.localeCompare(sourcesInFolder[b].title);
      });

      let folderUnreadCount = 0;
      let folderTotalCount = 0;

      const sourcesHtml = sortedSourceUrls.map(url => {
        const data = sourcesInFolder[url];
        const sourceItems = data.items.sort((a, b) => b.timestamp - a.timestamp);
        const sourceUnreadCount = sourceItems.filter(i => !i.read).length;
        const sourceTotalCount = sourceItems.length;
        folderUnreadCount += sourceUnreadCount;
        folderTotalCount += sourceTotalCount;

        const sourceId = `source:${url}`;
        const isCollapsed = collapsedState[sourceId] ? " collapsed" : "";
        const ariaExpanded = collapsedState[sourceId] ? "false" : "true";

        const errorHtml = data.error ? `<span class="icon-error" title="${escapeHtml(data.error)}">${SVG_ALERT}</span>` : "";
        const refreshTitle = data.error ? t("ui_retry_source") : t("ui_refresh_source");
        const refreshClass = data.error ? "icon-btn has-error" : "icon-btn";

        return `
          <div class="source-group">
            <h4 class="collapsible-header source-header${isCollapsed}" data-toggle-id="${sourceId}">
              <button class="chevron-btn" aria-expanded="${ariaExpanded}">${SVG_CHEVRON}</button>
              <span><a href="${escapeHtml(data.siteUrl)}" class="source-title-link" data-action="open-site" title="${escapeHtml(t("ui_open_site"))}">${escapeHtml(data.title)}</a> <span class="counter">(${sourceUnreadCount}/${sourceTotalCount})</span> ${errorHtml}</span>
              <div class="source-actions">
                <button class="${refreshClass}" data-action="refresh-source" data-url="${escapeHtml(data.url)}" title="${escapeHtml(refreshTitle)}">
                  ${SVG_REFRESH}${SVG_STOP_SM}
                </button>
                <button class="icon-btn" data-action="edit-source" data-url="${escapeHtml(data.url)}" title="${t("ui_edit")}">
                  ${SVG_EDIT}
                </button>
                <button class="icon-btn" data-action="delete-source" data-url="${escapeHtml(data.url)}" title="${t("ui_delete")}">
                  ${SVG_TRASH}
                </button>
              </div>
            </h4>
            <div class="group-content">
              ${sourceItems.map(i => renderItemHtml(i)).join("")}
            </div>
          </div>
        `;
      }).join("");

      const folderId = `folder:${folder}`;
      const isCollapsed = collapsedState[folderId] ? " collapsed" : "";
      const ariaExpanded = collapsedState[folderId] ? "false" : "true";
      const hue = folderHues[folder];
      const hueStyle = hue !== null ? `style="--hue: ${hue};"` : "";

      return `
        <div class="folder-group">
          <h3 class="collapsible-header folder-header${isCollapsed}" data-toggle-id="${folderId.replace(/"/g, "&quot;")}">
            <button class="chevron-btn" aria-expanded="${ariaExpanded}">${SVG_CHEVRON}</button>
            <span class="folder-tag" ${hueStyle}>${escapeHtml(folder)} <span class="counter">(${folderUnreadCount}/${folderTotalCount})</span></span>
          </h3>
          <div class="group-content">
            ${sourcesHtml}
          </div>
        </div>
      `;
    }).join("");
  } else {
    // Tri par timestamp (plus récent en haut)
    items.sort((a, b) => b.timestamp - a.timestamp);
    feedList.innerHTML = items.map(item => renderItemHtml(item, sourceMap[item.xmlUrl])).join("");
  }

  applyScanUIState();

  // Délégation d'événements pour le buffer
  // Performance : Un seul listener sur le conteneur plutôt que N listeners sur chaque bouton.
  feedList.onclick = async (e) => {
    // 0. Ouverture du site web de la source (clic sur le titre de la source)
    const siteLink = e.target.closest("a[data-action='open-site']");
    if (siteLink) {
      e.preventDefault();
      e.stopPropagation();
      const background = e.ctrlKey || e.metaKey;
      chrome.tabs.create({ url: siteLink.href, active: !background });
      return;
    }

    // 1. Gestion des actions de Source (Refresh / Edit / Delete)
    const actionBtn = e.target.closest("button[data-action='refresh-source'], button[data-action='edit-source'], button[data-action='delete-source']");
    if (actionBtn) {
      // Subtilité : e.stopPropagation() est crucial ici.
      // Sans cela, le clic remonterait au parent (.collapsible-header)
      // et déclencherait involontairement la fermeture/ouverture du dossier.
      e.stopPropagation(); 
      const url = actionBtn.dataset.url;
      
      if (actionBtn.dataset.action === "refresh-source") {
        if (actionBtn.classList.contains("spinning")) {
          chrome.runtime.sendMessage({ action: "cancel_scan" });
          return;
        }
        setScanningUI(true, "single", url);
        chrome.runtime.sendMessage({ action: "scan_source", xmlUrl: url });
      } else if (actionBtn.dataset.action === "edit-source") {
        const sources = await DB.getSources();
        const source = sources.find(s => s.xmlUrl === url);
        if (source) openEditOverlay(source);
      } else {
        if (confirm(t("ui_confirm_delete"))) {
          await DB.deleteSource(url);
          renderApp();
        }
      }
      return;
    }

    const header = e.target.closest(".collapsible-header");
    if (header) {
      // Pour les sources, seul le clic sur la flèche (.chevron-btn) replie/déplie
      if (header.classList.contains("source-header") && !e.target.closest(".chevron-btn")) {
        return;
      }
      header.classList.toggle("collapsed");
      const isCollapsed = header.classList.contains("collapsed");
      
      const chevron = header.querySelector(".chevron-btn");
      if (chevron) chevron.setAttribute("aria-expanded", !isCollapsed);

      const toggleId = header.dataset.toggleId;
      if (toggleId) {
        const s = await chrome.storage.local.get(["collapsed"]);
        const c = s.collapsed || {};
        if (header.classList.contains("collapsed")) {
          c[toggleId] = true;
        } else {
          delete c[toggleId];
        }
        chrome.storage.local.set({ collapsed: c });
      }
      return;
    }

    const btn = e.target.closest("button, a");
    if (!btn) return;

    const row = btn.closest(".item-row");
    const id = row.dataset.id;
    const action = btn.dataset.action;

    if (action === "open") {
      e.preventDefault();
      // Subtilité critique : On doit marquer l'item comme "lu" AVANT d'ouvrir l'onglet.
      // Raison : Ouvrir un onglet actif provoque la fermeture immédiate de la Popup par Chrome,
      // ce qui tue instantanément ce processus JS. Tout code après tabs.create ne s'exécuterait pas.
      if (!row.classList.contains("is-read")) {
        await DB.setItemRead(id, true);
        applyRowReadState(row, true);
        syncUnreadCountersAndBadge(row);
      }
      const background = e.ctrlKey || e.metaKey;
      chrome.tabs.create({ url: btn.href, active: !background });
    } else if (action === "toggle-read") {
      const nextRead = !row.classList.contains("is-read");
      await DB.setItemRead(id, nextRead);
      applyRowReadState(row, nextRead);
      syncUnreadCountersAndBadge(row);
    }
  };
}

/**
 * Génère le HTML d'une ligne d'article.
 * @param {Object} item - L'article à afficher.
 * @param {Object|null} sourceInfo - Infos de la source (pour l'affichage en mode Date).
 * @returns {string} HTML string.
 */
function renderItemHtml(item, sourceInfo = null) {
  const timeAgo = formatTimeAgo(item.timestamp);
  let metaContent = timeAgo;
  if (sourceInfo) {
    const hueStyle = (sourceInfo.hue !== null && sourceInfo.hue !== undefined) 
      ? `style="--hue: ${sourceInfo.hue};"` 
      : "";
    const folderHtml = `<span class="folder-tag" ${hueStyle}>${escapeHtml(sourceInfo.folder)}</span>`;
    metaContent = `${folderHtml} &bull; ${escapeHtml(sourceInfo.title)} &bull; ${timeAgo}`;
  }
  const metaHtml = `<div class="item-meta">${metaContent}</div>`;
  const isRead = Boolean(item.read);
  const rowClass = isRead ? "item-row is-read" : "item-row";
  const toggleTitle = isRead ? t("action_mark_unread") : t("action_mark_read");

  return `
    <div class="${rowClass}" data-id="${item.id}">
      <div class="item-content">
        <a href="${escapeHtml(addRef(item.link))}" target="_blank" class="item-link no-margin-right" data-action="open">
          ${escapeHtml(item.title)}
        </a>
        ${metaHtml}
      </div>
      <button class="read-toggle-btn" data-action="toggle-read" aria-pressed="${isRead}" title="${escapeHtml(toggleTitle)}">${SVG_CHECK}</button>
    </div>
  `;
}

/**
 * Injecté dans l'onglet actif pour détecter un document XML RSS/Atom ou les liens de flux.
 */
function extractPageFeedSignals() {
  const docType = (document.contentType || "").toLowerCase();
  const rootName = (document.documentElement?.localName || "").toLowerCase();
  const xmlViewerRoot = document.querySelector("#webkit-xml-viewer-source-xml");
  const isXmlDoc =
    docType.includes("xml") ||
    docType.includes("rss") ||
    docType.includes("atom") ||
    rootName === "rss" ||
    rootName === "feed" ||
    rootName === "rdf" ||
    Boolean(xmlViewerRoot && /<(?:rss|feed|rdf:RDF)(?:\s|>)/i.test(xmlViewerRoot.innerHTML.slice(0, 2048)));

  let xmlTitle = "";
  if (isXmlDoc) {
    const titleEl =
      document.querySelector("channel > title, feed > title") ||
      xmlViewerRoot?.querySelector("channel > title, feed > title");
    if (titleEl && titleEl.textContent) {
      xmlTitle = titleEl.textContent.trim().replace(/\s+/g, " ");
    }
  }

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (rawUrl, title = "") => {
    try {
      const resolved = new URL(rawUrl, location.href);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
      const href = resolved.toString();
      if (seen.has(href)) return;
      seen.add(href);
      candidates.push({ url: href, title: (title || "").trim().replace(/\s+/g, " ") });
    } catch (e) {}
  };

  // 1. Balises <link> (alternate / feed)
  document.querySelectorAll("link[href]").forEach((el) => {
    const relTokens = (el.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    if (!relTokens.includes("alternate") && !relTokens.includes("feed")) return;

    const type = (el.getAttribute("type") || "").toLowerCase();
    const title = el.getAttribute("title") || "";
    const href = el.getAttribute("href") || "";

    if (/oembed|rsd|opensearch/i.test(type) || /oembed/i.test(title)) return;

    const looksLikeFeedType = /rss|atom|rdf|xml/.test(type);
    const looksLikeFeedHref = !type && /(?:rss|feed|atom|\.xml)/i.test(href);
    if (looksLikeFeedType || looksLikeFeedHref) {
      pushCandidate(href, title);
    }
  });

  // 2. Liens <a> dans la page pointant vers un flux probable
  document.querySelectorAll("a[href]").forEach((el) => {
    const href = el.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

    const text = (el.textContent || "").trim();
    const title = el.getAttribute("title") || el.getAttribute("aria-label") || "";
    const combinedLabel = `${text} ${title}`;

    if (/sitemap/i.test(href)) return;
    const hrefMatch = /(?:^|[/?#._-])(rss|feed|atom)(?:$|[/?#._-])|\.xml(?:$|[?#])/i.test(href);
    const labelMatch = /\b(rss|atom|xml)\b|\bfeed\b/i.test(combinedLabel);
    if (hrefMatch || labelMatch) {
      pushCandidate(href, title || text);
    }
  });

  return { isXmlDoc, xmlTitle, candidates };
}

/**
 * Détermine si un flux ressemble à un flux de commentaires (à déprioriser).
 * @param {{url: string, title: string}} feed
 * @returns {boolean}
 */
function isCommentFeed(feed) {
  return /\/comments?(?:\/|$)|comment/i.test(feed.url) || /\bcomments?\b|评论/i.test(feed.title);
}

/**
 * Ouvre le sélecteur lorsque plusieurs flux valides sont détectés sur la page.
 */
function openFeedPicker(feeds, fallbackTitle, origin, siteUrl = "") {
  const pickerDialog = document.getElementById("feed-picker-dialog");
  const listEl = document.getElementById("feed-picker-list");
  const manualBtn = document.getElementById("feed-picker-manual");
  if (!pickerDialog || !listEl) {
    openEditOverlay({
      xmlUrl: feeds[0].url,
      siteUrl,
      title: feeds[0].title || fallbackTitle,
      folder: "",
      notify: true,
    });
    return;
  }

  listEl.innerHTML = "";
  feeds.forEach((feed) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feed-picker-item";

    const titleSpan = document.createElement("span");
    titleSpan.className = "feed-picker-title";
    titleSpan.textContent = feed.title || fallbackTitle || feed.url;

    const urlSpan = document.createElement("span");
    urlSpan.className = "feed-picker-url";
    urlSpan.textContent = feed.url;

    btn.appendChild(titleSpan);
    btn.appendChild(urlSpan);
    btn.addEventListener("click", () => {
      pickerDialog.close();
      openEditOverlay({
        xmlUrl: feed.url,
        siteUrl,
        title: feed.title || fallbackTitle || t("source_new_title"),
        folder: "",
        notify: true,
      });
    });
    listEl.appendChild(btn);
  });

  if (manualBtn) {
    manualBtn.onclick = () => {
      pickerDialog.close();
      openEditOverlay({
        xmlUrl: origin || "",
        siteUrl,
        title: fallbackTitle || t("source_new_title"),
        folder: "",
        notify: true,
      });
    };
  }

  pickerDialog.showModal();
}

/**
 * Détecte un flux RSS sur l'onglet actif (y compris XML ouvert directement) et ouvre le formulaire d'ajout.
 */
async function detectAndAddFeed() {
  if (addBtn.disabled) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  let origin = "";
  addBtn.disabled = true;
  addBtn.classList.add("detecting");

  try {
    if (!tab.url) throw new Error("Invalid URL");

    const urlObj = new URL(tab.url);
    origin = urlObj.origin;

    if (!urlObj.protocol.startsWith("http")) throw new Error("System page");

    let pageSignals = { isXmlDoc: false, xmlTitle: "", candidates: [] };
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageFeedSignals,
      });
      if (result) pageSignals = result;
    } catch (e) {
      // Certaines pages XML ou restreintes peuvent bloquer l'injection : on continue avec tab.url
    }

    // ÉTAPE 1 : Vérifier si l'onglet courant lui-même est un flux RSS/Atom XML
    const currentCheck = await chrome.runtime.sendMessage({
      action: "test_url",
      url: tab.url,
    });
    if (currentCheck && currentCheck.valid) {
      openEditOverlay({
        xmlUrl: currentCheck.url || tab.url,
        title: currentCheck.title || pageSignals.xmlTitle || tab.title || t("source_new_title"),
        folder: "",
        notify: true,
      });
      return;
    }

    // ÉTAPE 2 : Vérifier les candidats extraits du DOM (<link> et <a>)
    const domTitleMap = new Map();
    const domUrls = [];
    for (const c of pageSignals.candidates) {
      domUrls.push(c.url);
      if (c.title) domTitleMap.set(c.url, c.title);
    }

    let validFeeds = [];
    if (domUrls.length > 0) {
      const probeRes = await chrome.runtime.sendMessage({
        action: "probe_feeds",
        urls: domUrls,
      });
      if (probeRes && Array.isArray(probeRes.feeds)) {
        validFeeds = probeRes.feeds.map((f) => ({
          url: f.url,
          title: f.title || domTitleMap.get(f.url) || "",
        }));
      }
    }

    // ÉTAPE 3 : Si rien n'est trouvé dans le DOM, tester les chemins classiques
    if (validFeeds.length === 0) {
      const patterns = [
        `${origin}/feed/`,
        `${origin}/feed`,
        `${origin}/rss/`,
        `${origin}/rss.xml`,
        `${origin}/atom.xml`,
        `${origin}/feed.xml`,
        `${origin}/index.xml`,
        `${origin}/rss`,
      ];
      const fallbackRes = await chrome.runtime.sendMessage({
        action: "probe_feeds",
        urls: patterns,
      });
      if (fallbackRes && Array.isArray(fallbackRes.feeds)) {
        validFeeds = fallbackRes.feeds;
      }
    }

    // Déprioriser les flux de commentaires
    validFeeds.sort((a, b) => Number(isCommentFeed(a)) - Number(isCommentFeed(b)));

    if (validFeeds.length === 1) {
      openEditOverlay({
        xmlUrl: validFeeds[0].url,
        siteUrl: tab.url,
        title: validFeeds[0].title || tab.title || t("source_new_title"),
        folder: "",
        notify: true,
      });
    } else if (validFeeds.length > 1) {
      openFeedPicker(validFeeds, tab.title, origin, tab.url);
    } else {
      openEditOverlay({
        xmlUrl: origin,
        siteUrl: tab.url,
        title: tab.title || t("source_new_title"),
        folder: "",
        notify: true,
      });
    }
  } catch (err) {
    if (err.message !== "System page" && err.message !== "Invalid URL") {
      console.error("RSSext: Erreur de détection", err);
    }
    openEditOverlay({
      xmlUrl: origin || "",
      title: tab.title || t("source_new_title"),
      folder: "",
      notify: true,
    });
  } finally {
    addBtn.disabled = false;
    addBtn.classList.remove("detecting");
  }
}

/**
 * Ouvre la modale d'édition/ajout de source.
 * @param {Object} source - L'objet source (xmlUrl, title, folder...).
 */
async function openEditOverlay(source) {
  document.getElementById("edit-name").value = source.title;
  const urlInput = document.getElementById("edit-url");
  if (urlInput) {
    urlInput.value = source.xmlUrl;
  }
  const siteUrlInput = document.getElementById("edit-site-url");
  if (siteUrlInput) {
    const hasDistinctSite = source.siteUrl && !isSameUrl(source.siteUrl, source.xmlUrl);
    siteUrlInput.value = hasDistinctSite ? source.siteUrl : "";
  }
  
  // Population du Select Dossier
  const select = document.getElementById("edit-folder");
  select.innerHTML = "";
  
  const optGen = document.createElement("option");
  optGen.value = "";
  optGen.textContent = t("folder_general");
  select.appendChild(optGen);

  const sources = await DB.getSources();
  const folders = new Set(sources.map(s => s.folder).filter(f => f));
  Array.from(folders).sort().forEach(f => {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f;
    select.appendChild(opt);
  });

  const optNew = document.createElement("option");
  optNew.value = "__NEW__";
  optNew.textContent = `[ ${t("ui_add_folder_option")} ]`;
  select.appendChild(optNew);

  select.value = source.folder || "";
  document.getElementById("edit-notify").checked = source.notify;
  document.getElementById("edit-filter-include").value = source.filter?.include || "";
  document.getElementById("edit-filter-exclude").value = source.filter?.exclude || "";
  document.getElementById("edit-filter-content").checked = Boolean(source.filter?.matchContent);

  // On stocke l'URL dans le dataset du dialog pour le submit
  dialog.dataset.currentUrl = source.xmlUrl;
  dialog.showModal();
}

/**
 * Gère la validation et la soumission du formulaire d'édition.
 * @param {Event} e - L'événement submit.
 */
async function handleDialogSubmit(e) {
  e.preventDefault();
  const action = e.submitter.value;
  const oldUrl = dialog.dataset.currentUrl;

  if (action !== "save") {
    dialog.close();
    return;
  }

  const urlInput = document.getElementById("edit-url");
  const newUrl = urlInput ? urlInput.value.trim() : oldUrl;
  const siteUrlInput = document.getElementById("edit-site-url");
  const rawSiteUrl = siteUrlInput ? siteUrlInput.value.trim() : "";

  if (rawSiteUrl) {
    let validSite = false;
    try {
      const parsedSite = new URL(rawSiteUrl);
      validSite = parsedSite.protocol === "http:" || parsedSite.protocol === "https:";
    } catch (err) {}
    if (!validSite && siteUrlInput) {
      siteUrlInput.setCustomValidity("Invalid URL");
      siteUrlInput.reportValidity();
      siteUrlInput.addEventListener("input", () => siteUrlInput.setCustomValidity(""), { once: true });
      return;
    }
  }

  const saveBtn = e.submitter;
  saveBtn.disabled = true;
  saveBtn.style.cursor = "wait";

  try {
    const check = await chrome.runtime.sendMessage({ action: "test_url", url: newUrl });
    if (!check || !check.valid) {
      if (urlInput) {
        urlInput.setCustomValidity("Invalid URL");
        urlInput.reportValidity();
        urlInput.addEventListener("input", () => urlInput.setCustomValidity(""), { once: true });
      }
      return;
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.style.cursor = "";
  }

  let folder = document.getElementById("edit-folder").value;
  if (folder === "__NEW__") folder = "";

  // Si c'est un nouveau dossier, on s'assure qu'il a une couleur
  if (folder) await DB.getFolderHue(folder);

  const existingSources = await DB.getSources();
  const prevSource = existingSources.find(s => s.xmlUrl === oldUrl);

  const includeRaw = document.getElementById("edit-filter-include").value.trim();
  const excludeRaw = document.getElementById("edit-filter-exclude").value.trim();
  const matchContent = document.getElementById("edit-filter-content").checked;

  const normalizeFilter = (f) => ({
    include: (f?.include || "").trim(),
    exclude: (f?.exclude || "").trim(),
    matchContent: Boolean(f?.matchContent),
  });
  const prevFilter = normalizeFilter(prevSource?.filter);
  const nextFilter = normalizeFilter({
    include: includeRaw,
    exclude: excludeRaw,
    matchContent,
  });
  const filterChanged =
    Boolean(prevSource) &&
    (prevFilter.include !== nextFilter.include ||
      prevFilter.exclude !== nextFilter.exclude ||
      prevFilter.matchContent !== nextFilter.matchContent);

  const nextSource = {
    xmlUrl: newUrl,
    title: document.getElementById("edit-name").value,
    folder: folder,
    notify: document.getElementById("edit-notify").checked,
  };
  if (nextFilter.include || nextFilter.exclude || nextFilter.matchContent) {
    nextSource.filter = nextFilter;
  }
  if (rawSiteUrl && !isSameUrl(rawSiteUrl, newUrl)) {
    nextSource.siteUrl = rawSiteUrl;
  } else if (!siteUrlInput && prevSource && newUrl === oldUrl && prevSource.siteUrl && !isSameUrl(prevSource.siteUrl, newUrl)) {
    nextSource.siteUrl = prevSource.siteUrl;
  }

  await DB.putSource(nextSource);

  if (oldUrl && newUrl !== oldUrl) {
    await DB.deleteSource(oldUrl);
  } else if (filterChanged) {
    await DB.deleteItemsBySource(newUrl);
  }

  if (filterChanged || (oldUrl && newUrl !== oldUrl)) {
    chrome.runtime.sendMessage({ action: "scan_source", xmlUrl: newUrl });
  } else {
    chrome.runtime.sendMessage({ action: "scan_now" });
  }

  dialog.close();
  renderApp();
}

/**
 * Met à jour l'état visuel lu/non-lu d'une ligne d'article.
 * @param {HTMLElement} row - Élément .item-row cible.
 * @param {boolean} isRead - Nouvel état de lecture.
 */
function applyRowReadState(row, isRead) {
  if (!row) return;
  row.classList.toggle("is-read", isRead);
  const toggleBtn = row.querySelector("button[data-action='toggle-read']");
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-pressed", isRead ? "true" : "false");
    toggleBtn.title = isRead ? t("action_mark_unread") : t("action_mark_read");
  }
}

/**
 * Met à jour le compteur "(non-lus/total)" d'un groupe (source ou dossier).
 * @param {HTMLElement|null} groupEl - Élément .source-group ou .folder-group.
 */
function updateGroupCounter(groupEl) {
  if (!groupEl || !groupEl.isConnected) return;
  const counter = groupEl.querySelector(".counter");
  if (!counter) return;
  const unread = groupEl.querySelectorAll(".item-row:not(.is-read)").length;
  const total = groupEl.querySelectorAll(".item-row").length;
  counter.textContent = `(${unread}/${total})`;
}

/**
 * Recalcule les compteurs de non-lus (badge, dossiers, sources, bouton tout marquer lu).
 * @param {HTMLElement|null} targetRow - Ligne modifiée (optionnel, optimise la maj dossier/source).
 */
function syncUnreadCountersAndBadge(targetRow = null) {
  const unreadCount = document.querySelectorAll(".item-row:not(.is-read)").length;
  chrome.action.setBadgeText({ text: unreadCount > 0 ? unreadCount.toString() : "" });

  const markAllBtn = document.getElementById("mark-all-read");
  if (markAllBtn) {
    markAllBtn.classList.toggle("hidden", unreadCount === 0);
  }

  if (targetRow) {
    updateGroupCounter(targetRow.closest(".source-group"));
    updateGroupCounter(targetRow.closest(".folder-group"));
  } else {
    document.querySelectorAll(".source-group").forEach(updateGroupCounter);
    document.querySelectorAll(".folder-group").forEach(updateGroupCounter);
  }
}

/**
 * Supprime visuellement une ligne du DOM avec animation
 * et met à jour les compteurs des dossiers/sources.
 * @param {string} id - L'ID de l'item à supprimer
 */
function removeRowVisually(id) {
  const row = document.querySelector(`.item-row[data-id="${id}"]`);
  if (!row) return; // L'article n'est pas dans le DOM actuel

  // Animation de sortie
  row.classList.add("dismissing");

  // On attend la fin de l'animation CSS avant de supprimer du DOM
  setTimeout(() => {
    const sourceGroup = row.closest(".source-group");
    const folderGroup = row.closest(".folder-group");
    
    row.remove();

    const remaining = document.querySelectorAll(".item-row").length;
    const unread = document.querySelectorAll(".item-row:not(.is-read)").length;
    chrome.action.setBadgeText({ text: unread > 0 ? unread.toString() : "" });

    // Si c'était le dernier, on relance le rendu pour afficher l'état vide
    if (remaining === 0) {
      renderApp(); 
    } else {
      updateGroupCounter(sourceGroup);
      updateGroupCounter(folderGroup);
    }
  }, 300);
}

function isSameUrl(a, b) {
  try {
    return new URL(a).toString() === new URL(b).toString();
  } catch (e) {
    return a === b;
  }
}

/**
 * Résout l'URL du site web cible pour une source donnée.
 * @param {Object} source - L'objet source.
 * @returns {string} L'URL du site web ou de repli.
 */
function getSourceSiteUrl(source) {
  if (source.siteUrl && !isSameUrl(source.siteUrl, source.xmlUrl)) {
    return source.siteUrl;
  }
  try {
    return new URL(source.xmlUrl).origin;
  } catch (e) {
    return source.xmlUrl;
  }
}

/**
 * Met à jour l'état visuel de scan en cours dans la popup.
 * @param {boolean} scanning - Indique si un scan est en cours.
 * @param {string|null} mode - Mode de scan ('all'|'failed'|'single').
 * @param {string|null} xmlUrl - URL de la source ciblée pour 'single'.
 */
function setScanningUI(scanning, mode = null, xmlUrl = null) {
  activeScanState = { scanning, mode, xmlUrl };
  applyScanUIState();
}

/**
 * Applique l'état de rotation / arrêt sur un bouton de rafraîchissement.
 * @param {HTMLElement} btn
 * @param {boolean} isThisSpinning
 * @param {boolean} isAnyScanning
 */
function syncSpinButtonState(btn, isThisSpinning, isAnyScanning) {
  if (!btn) return;
  if (isThisSpinning) {
    if (!btn.dataset.originalTitle) {
      btn.dataset.originalTitle = btn.title || "";
    }
    btn.title = t("ui_stop_scan");
    btn.disabled = false;
    btn.classList.add("spinning");
  } else {
    if (btn.dataset.originalTitle !== undefined) {
      btn.title = btn.dataset.originalTitle;
      delete btn.dataset.originalTitle;
    }
    btn.disabled = isAnyScanning;
    btn.classList.remove("spinning");
  }
}

/**
 * Applique les classes et états disabled selon activeScanState.
 */
function applyScanUIState() {
  const { scanning, mode, xmlUrl } = activeScanState;
  const isAllSpinning = scanning && mode !== "failed" && mode !== "single";
  const isFailedSpinning = scanning && mode === "failed";

  syncSpinButtonState(refreshAllBtn, isAllSpinning, scanning);
  syncSpinButtonState(retryFailedBtn, isFailedSpinning, scanning);

  document.querySelectorAll("button[data-action='refresh-source']").forEach((btn) => {
    const isSingleSpinning = scanning && mode === "single" && btn.dataset.url === xmlUrl;
    syncSpinButtonState(btn, isSingleSpinning, scanning);
  });
}

/**
 * Écouteur d'événements globaux provenant du Background
 * Utile pour rafraîchir l'interface si l'utilisateur interagit 
 * avec les notifications pendant que la popup est ouverte.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "set_item_read_ui" && message.itemId) {
    const row = document.querySelector(`.item-row[data-id="${message.itemId}"]`);
    if (row) {
      applyRowReadState(row, Boolean(message.read));
      syncUnreadCountersAndBadge(row);
    }
  } else if (message.action === "hide_item_ui" && message.itemId) {
    removeRowVisually(message.itemId);
  } else if (message.action === "scan_started") {
    setScanningUI(true, message.mode || "all", message.xmlUrl || null);
  } else if (message.action === "scan_finished") {
    setScanningUI(false);
    renderApp();
  }
});
