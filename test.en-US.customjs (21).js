(function (w, d) {
  "use strict";

  /* =============================
     0) CONFIG & CONSTANTS
     ============================= */

  // Outstanding Orders (Oracle open order lines)
  const OUTSTANDING_API = "/_api/cr650_dcl_outstanding_reports";

  /* === FG MASTER CACHE === */
  let FG_MASTER = [];
  w.FG_MASTER = FG_MASTER;

  async function loadFgMasterCache() {
    const data = await fetch("/_api/cr650_productspecifications?$top=5000")
      .then(r => r.json())
      .then(d => d.value || []);
    FG_MASTER = data;
    w.FG_MASTER = FG_MASTER;
  }
  loadFgMasterCache();

  // Shipped Orders endpoint (Delivery Notes & Container # history)
  const SHIPPED_API = "/_api/cr650_dcl_shipped_orderses";
  const SHIPPED_FIELDS = [
    "cr650_order_number", "cr650_item_no", "cr650_delivery_note", "cr650_shipment_date", "createdon", "cr650_container_no"
  ];

  // DCL→Orders child table (links DCL master → oracle SO#)
  const DCL_ORDERS_API = "/_api/cr650_dcl_orders";
  const DCL_ORDER_FIELDS = [
    "cr650_dcl_orderid", "cr650_order_number", "_cr650_dcl_number_value", "createdon"
  ];

  // DCL Loading Plan table (persisted loading rows)
  const DCL_LP_API = "/_api/cr650_dcl_loading_plans";
  const DCL_LP_FIELDS = [
    "cr650_dcl_loading_planid",
    "_cr650_dcl_number_value",
    "cr650_ordernumber",
    "cr650_itemcode",
    "cr650_itemdescription",
    "cr650_releasestatus",
    "cr650_packagingdetails",
    "cr650_unitofmeasure",
    "cr650_packagetype",
    "cr650_orderedquantity",
    "cr650_loadedquantity",
    "cr650_pendingquantity",
    "cr650_ispalletized",
    "cr650_palletcount",
    "cr650_palletweight",
    "cr650_totalvolumeorweight",
    "cr650_netweightkg",
    "cr650_grossweightkg",
    "createdon",
    "modifiedon"
  ];


  // DCL Master API (parent record totals we PATCH)
  const DCL_MASTER_API = "/_api/cr650_dcl_masters";

  // DCL Containers API (card view in Step 1)
  const DCL_CONTAINERS_API = "/_api/cr650_dcl_containers";

  // NEW: DCL Container Items API
  // Note: Palletized and # Pallets are stored in the Loading Plan table, not Container Items
  const DCL_CONTAINER_ITEMS_API = "/_api/cr650_dcl_container_itemses";
  const DCL_CONTAINER_ITEMS_FIELDS = [
    "cr650_dcl_container_itemsid",
    "cr650_quantity",
    "_cr650_loadingplanitem_value",
    "_cr650_dcl_number_value",
    "_cr650_dcl_master_number_value",
    "cr650_issplititem",
    "createdon"
  ];



  // Other DCL-related APIs you already had
  const NOTIFY_API = "/_api/cr650_dcl_notify_parties";
  const TERMS_API = "/_api/cr650_dcl_terms_conditionses";
  const BRANDS_API = "/_api/cr650_dcl_brands";

  const CONTAINER_CAPACITY_KG = {
    "20ft Container": 21000,
    "40ft Container": 26000,
    "40ft High Cube": 26500,
    "ISO Tank Container": 30000,
    "Flexi Bag 20ft": 24000,
    "Flexi Bag 40ft": 26000,
    "Bulk Tanker": 32000,
    "Truck": 24000
  };


  // Container constraints for UI
  const CONTAINER_CONSTRAINTS = {
    "20ft Container": { maxWeight: 21000, maxVolume: 33 },
    "40ft Container": { maxWeight: 26000, maxVolume: 67 },
    "40ft High Cube": { maxWeight: 26500, maxVolume: 76 },
    "ISO Tank Container": { maxWeight: 30000, maxVolume: 26 },
    "Flexi Bag 20ft": { maxWeight: 24000, maxVolume: 24 },
    "Flexi Bag 40ft": { maxWeight: 26000, maxVolume: 26 },
    "Bulk Tanker": { maxWeight: 32000, maxVolume: null },
    "Truck": { maxWeight: 24000, maxVolume: null }
  };

  // Option set numeric values for cr650_container_type
  const CONTAINER_TYPE_OPTIONSET = {
    "20ft Container": 1,
    "40ft Container": 2,
    "40ft High Cube": 3,
    "ISO Tank Container": 4,
    "Flexi Bag 20ft": 5,
    "Flexi Bag 40ft": 6,
    "Bulk Tanker": 7,
    "Truck": 8
  };


  /* =============================
   DCL STATUS CHECK
   ============================= */
  let DCL_STATUS = null;

  async function fetchDclStatus(dclGuid) {
    if (!dclGuid || !isGuid(dclGuid)) return null;

    try {
      const data = await safeAjax({
        type: "GET",
        url: `${DCL_MASTER_API}(${dclGuid})?$select=cr650_status`,
        headers: {
          Accept: "application/json;odata.metadata=minimal"
        },
        dataType: "json",
        _withLoader: false
      });

      DCL_STATUS = data && data.cr650_status ? data.cr650_status : null;
      console.log("📋 DCL Status:", DCL_STATUS);

      return DCL_STATUS;
    } catch (err) {
      console.error("Failed to fetch DCL status:", err);
      return null;
    }
  }
  /* =============================
     FORM LOCKING FOR SUBMITTED DCLs
     ============================= */
  function lockLoadingPlanIfSubmitted() {
    try {
      const status = (DCL_STATUS || "").toLowerCase();

      if (status !== "submitted") {
        console.log("📝 Loading Plan is editable - status:", DCL_STATUS || "none");
        return;
      }

      console.log("🔒 Locking Loading Plan - DCL status is 'Submitted'");

      // 1. Disable all table inputs
      const tableInputs = document.querySelectorAll(
        "#itemsTableBody input, " +
        "#itemsTableBody select, " +
        "#itemsTableBody textarea, " +
        "#itemsTableBody button"
      );

      tableInputs.forEach(el => {
        el.disabled = true;
        el.style.cursor = "not-allowed";
        el.style.opacity = "0.6";
        el.style.pointerEvents = "none";
      });

      // 2. Disable contentEditable cells
      document.querySelectorAll("#itemsTableBody .ce, #itemsTableBody .ce-editing").forEach(cell => {
        cell.contentEditable = "false";
        cell.style.cursor = "not-allowed";
        cell.style.backgroundColor = "#f5f5f5";
      });

      // 3. Disable all action buttons
      const actionButtons = document.querySelectorAll(
        "#addItemBtn, " +
        "#importFromOracleBtn, " +
        "#updateAllBtn, " +
        "#addContainerBtn, " +
        "#startAllocationBtn, " +
        "#autoAssignBtn, " +
        "#resetAssignmentsBtn, " +
        "#addDiscountChargeBtn, " +
        "#saveDiscountsBtn, " +
        "#loadDiscountsBtn, " +
        ".lp-edit, " +
        ".row-save, " +
        ".row-cancel, " +
        ".row-remove, " +
        ".dc-remove, " +
        ".split-item, " +
        ".add-dims-btn"
      );

      actionButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.display = "none";
      });

      // 4. Disable container management
      document.querySelectorAll(
        "#containerTypeSelect, " +
        "#containerQtyInput, " +
        "#containerMaxWeightInput, " +
        ".assign-container, " +
        ".ci-quantity"
      ).forEach(el => {
        el.disabled = true;
        el.style.cursor = "not-allowed";
      });

      // 7. Make tables read-only visually
      const tables = document.querySelectorAll(
        "#itemsTable, " +
        "#assignmentTable, "
      );

      tables.forEach(table => {
        table.style.opacity = "0.7";
        table.style.pointerEvents = "none";
      });


      // ✅ NEW: Lock LP Additional Comments Section
      const lpCommentsTextarea = document.getElementById("lpAdditionalComments");
      if (lpCommentsTextarea) {
        lpCommentsTextarea.disabled = true;
        lpCommentsTextarea.style.cursor = "not-allowed";
        lpCommentsTextarea.style.backgroundColor = "#f5f5f5";
        lpCommentsTextarea.style.opacity = "0.6";
      }

      // ✅ NEW: Lock Loading Plan Generation Section
      const generateLPBtn = document.getElementById("generateLP");
      if (generateLPBtn) {
        generateLPBtn.disabled = true;
        generateLPBtn.style.display = "none";
      }

      // ✅ NEW: Keep preview button visible but make it view-only
      const previewLPBtn = document.querySelector('[data-preview="lp"]');
      if (previewLPBtn) {
        // Only hide if there's no existing document to view
        if (!previewLPBtn.href || previewLPBtn.href === "#") {
          previewLPBtn.style.display = "none";
        } else {
          // Make it clear it's read-only
          const icon = previewLPBtn.querySelector("i");
          if (icon) {
            icon.classList.remove("fa-eye");
            icon.classList.add("fa-lock");
          }
        }
      }

      // ✅ NEW: Lock the entire document card
      const docCard = document.querySelector('.document-card');
      if (docCard) {
        docCard.style.opacity = "0.8";

        // Re-enable view link only if it exists
        const viewLink = docCard.querySelector('a[href]:not([href="#"])');
        if (viewLink) {
          viewLink.style.pointerEvents = "auto";
          viewLink.style.opacity = "1";
        }
      }

      // 8. Show locked banner
      showLoadingPlanLockedBanner();

      console.log("✅ Loading Plan fully locked");

    } catch (lockError) {
      console.error("❌ Error while locking Loading Plan:", lockError);
    }
  }

  function showLoadingPlanLockedBanner() {
    try {
      const wizard = document.getElementById("dclWizard");
      if (!wizard) {
        console.warn("Wizard container not found");
        return;
      }

      // Check if banner already exists
      if (document.getElementById("lockedBanner")) {
        console.log("Banner already exists");
        return;
      }

      const banner = document.createElement("div");
      banner.id = "lockedBanner";
      banner.style.cssText = `
      background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
      border: 2px solid #fca5a5;
      top: 0;
      z-index: 1000;
    `;

      banner.innerHTML = `
      <i class="fas fa-lock" style="font-size: 24px;"></i>
      <div style="flex: 1;">
        <div style="font-size: 16px; font-weight: 700; margin-bottom: 4px;">
          DCL Locked - Read Only Mode
        </div>
        <div style="font-size: 14px; opacity: 0.95;">
          This DCL has been submitted and cannot be modified.
        </div>
      </div>
    `;

      const firstSection = wizard.querySelector(".step-content");
      if (firstSection) {
        wizard.insertBefore(banner, firstSection);
      } else {
        wizard.insertBefore(banner, wizard.firstChild);
      }

    } catch (bannerError) {
      console.error("Error creating locked banner:", bannerError);
    }
  }

  const CONTAINER_TYPE_LABEL_FROM_OPTIONSET = {};
  Object.entries(CONTAINER_TYPE_OPTIONSET).forEach(([label, value]) => {
    CONTAINER_TYPE_LABEL_FROM_OPTIONSET[value] = label;
  });

  function mapContainerTypeToOptionValue(type) {
    return CONTAINER_TYPE_OPTIONSET[type] ?? null;
  }
  // In-memory state
  let DCL_CONTAINERS_STATE = [];
  // Each row: { id, lpId, quantity, containerGuid, dclMasterGuid }
  let DCL_CONTAINER_ITEMS_STATE = [];

  window.DCL_CONTAINER_ITEMS_STATE = DCL_CONTAINER_ITEMS_STATE;
  window.DCL_CONTAINERS_STATE = DCL_CONTAINERS_STATE;


  let ITEM_MASTER_CACHE = {};
  let CURRENT_DCL_ID = null;
  let LOADING_DATE = null;
  w.__LOADING_DATE = null;
  let CURRENCY_CODE = "USD";

  window.CURRENT_DCL_ID = CURRENT_DCL_ID;


  /* =============================
     0A) TOP LOADER BAR
     ============================= */
  function ensureTopLoader() {
    if (!d.getElementById("top-loader")) {
      const bar = d.createElement("div");
      bar.id = "top-loader";
      bar.className = "top-loader hidden";
      d.body.prepend(bar);
    }
  }
  ensureTopLoader();
  function setLoading(isLoading, textOpt) {
    const topbar = d.getElementById("top-loader");
    const main = d.querySelector(".main-section");
    const dclCreate = d.getElementById("dcl-create"); // ✅ Target the main content area
    const controls = d.querySelector(".dcl-controls");
    const tableEl = d.getElementById("itemsTableBody")?.closest("table");

    if (isLoading) {
      // Show top loader
      if (topbar) topbar.classList.remove("hidden");
      if (main) main.setAttribute("aria-busy", "true");

      // Update loading text if provided
      const info = d.getElementById("resultsInfo");
      if (info && textOpt) info.textContent = textOpt;

      // ✅ Blur the entire dcl-create section
      if (dclCreate) dclCreate.classList.add("blur-while-loading");

      // Blur specific elements (optional)
      if (controls) controls.classList.add("blur-while-loading");
      if (tableEl) tableEl.classList.add("blur-while-loading");
    } else {
      // Hide top loader
      if (topbar) topbar.classList.add("hidden");
      if (main) main.removeAttribute("aria-busy");

      // ✅ Remove blur from dcl-create section
      if (dclCreate) dclCreate.classList.remove("blur-while-loading");

      // Remove blur from specific elements
      if (controls) controls.classList.remove("blur-while-loading");
      if (tableEl) tableEl.classList.remove("blur-while-loading");
    }
  }


  /* =============================
     0B) DATA NORMALIZATION - NEW
     ============================= */

  // ✅ NEW: Normalize data types from Dataverse text fields to JavaScript numbers
  function normalizeOutstandingData(records) {
    return records.map(record => ({
      ...record,
      // Convert text fields to numbers
      cr650_order_no: Number(record.cr650_order_no),
      cr650_source_order_number: Number(record.cr650_source_order_number),
      cr650_line_number: Number(record.cr650_line_number),
      cr650_source_line_number: Number(record.cr650_source_line_number),
      cr650_product_pack: Number(record.cr650_product_pack),
      cr650_delivery_detail_id: record.cr650_delivery_detail_id ? Number(record.cr650_delivery_detail_id) : null
    }));
  }



  /* =============================
     1) HELPERS
     ============================= */

  const enc = encodeURIComponent;
  const asStr = (v) => (v == null ? "" : String(v));
  const asNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const fmt2 = (n) => round2(n).toFixed(2);

  const Q = (sel) => d.querySelector(sel);
  const QA = (sel) => Array.from(d.querySelectorAll(sel));

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[m]));
  }
  function setText(sel, v) { const n = Q(sel); if (n) n.textContent = v; }
  function getQueryParam(name) { return new URL(w.location.href).searchParams.get(name); }
  function isGuid(s) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(String(s || "").trim());
  }


  // Release status mapping
  function formatReleaseStatus(rawVal) {
    if (rawVal === 0 || rawVal === "0") return "Y";
    if (rawVal === 1 || rawVal === "1") return "N";
    return asStr(rawVal);
  }
  function parseReleaseStatusDisplayToRaw(disp) {
    const v = String(disp || "").toUpperCase();
    if (v === "Y") return 0;
    if (v === "N") return 1;
    return 1;
  }

  // Value type mapping
  function formatValueType(rawVal) {
    if (rawVal === 0 || rawVal === "0") return "Sale Price";
    if (rawVal === 1 || rawVal === "1") return "FOC value";
    if (rawVal === 2 || rawVal === "2") return "Priceless";
    return "Sale Price";
  }
  function parseValueTypeTextToNumber(txt) {
    const v = String(txt || "").toLowerCase();
    if (v === "sale price") return 0;
    if (v === "foc value") return 1;
    if (v === "priceless") return 2;
    return 0;
  }


  async function deleteAllContainerItemsForCurrentDcl() {
    if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) return;

    const dclLower = CURRENT_DCL_ID.toLowerCase();

    const lpRows = await fetchExistingLoadingPlansForCurrentDcl(CURRENT_DCL_ID);
    const lpIdSet = new Set(
      (lpRows || [])
        .map(r => (r.cr650_dcl_loading_planid || "").toLowerCase())
        .filter(Boolean)
    );

    const allCiRows = await fetchAllContainerItems(CURRENT_DCL_ID);

    const rowsToDelete = (allCiRows || []).filter(ci => {
      const masterLower = String(ci._cr650_dcl_master_number_value || "").toLowerCase();
      const lpLower = String(ci._cr650_loadingplanitem_value || "").toLowerCase();
      return masterLower === dclLower || (lpLower && lpIdSet.has(lpLower));
    });

    for (const ci of rowsToDelete) {
      const id = ci.cr650_dcl_container_itemsid || ci.id;
      if (!id) continue;
      try {
        await deleteContainerItem(id);
      } catch (err) {
        console.warn("Failed to delete container-item", id, err);
      }
    }

    DCL_CONTAINER_ITEMS_STATE = [];
  }

  /* =============================
     1A) DATE PARSING & FILTERING - NEW
     ============================= */

  /**
   * Parse ISO date string from DCL Master (e.g., "2025-10-02T21:00:00Z")
   * Returns timestamp in milliseconds
   */
  function parseISODate(isoString) {
    if (!isoString) return NaN;
    const ts = Date.parse(isoString);
    return Number.isNaN(ts) ? NaN : ts;
  }

  /**
   * Parse shipment date string (e.g., "21/07/2025 16:23:33")
   * Format: DD/MM/YYYY HH:mm:ss (day/month/year - international format)
   * Returns timestamp in milliseconds
   */
  function parseShipmentDate(dateString) {
    if (!dateString) return NaN;

    const match = String(dateString).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
    if (!match) {
      console.warn("⚠️ Shipment date doesn't match expected format:", dateString);
      return NaN;
    }

    const [_, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = match;

    // ✅ FIXED: Format is DD/MM/YYYY, so we need to rearrange to YYYY-MM-DD
    const ts = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`);

    if (Number.isNaN(ts)) {
      console.warn("⚠️ Failed to parse shipment date:", dateString, "→ dd:", dd, "mm:", mm, "yyyy:", yyyy);
      return NaN;
    }

    console.log(`📅 Parsed shipment date: "${dateString}" → ${new Date(ts).toISOString()}`);
    return ts;
  }

  /**
   * Check if a shipment date falls within the loading date window
   * Window: loadingDate - 5 days to loadingDate (inclusive)
   */
  function isWithinLoadingDateWindow(shipmentDateString, loadingDateISO) {
    if (!shipmentDateString || !loadingDateISO) {
      console.log("📅 No filtering applied (missing dates)");
      return true; // No filter if dates missing
    }

    const shipmentTs = parseShipmentDate(shipmentDateString);
    const loadingTs = parseISODate(loadingDateISO);

    if (Number.isNaN(shipmentTs)) {
      console.warn("⚠️ Could not parse shipment date, including record:", shipmentDateString);
      return true; // Include if we can't parse
    }

    if (Number.isNaN(loadingTs)) {
      console.warn("⚠️ Could not parse loading date, including record:", loadingDateISO);
      return true; // Include if we can't parse
    }

    // Calculate 5 days before loading date (in milliseconds)
    const fiveDaysInMs = 5 * 24 * 60 * 60 * 1000;
    const windowStart = loadingTs - fiveDaysInMs;
    const windowEnd = loadingTs;

    const isInWindow = shipmentTs >= windowStart && shipmentTs <= windowEnd;

    console.log(`📅 Date filter check:`, {
      shipmentDate: shipmentDateString,
      shipmentParsed: new Date(shipmentTs).toISOString(),
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(windowEnd).toISOString(),
      isInWindow: isInWindow,
      daysBeforeLoading: Math.round((loadingTs - shipmentTs) / (24 * 60 * 60 * 1000))
    });

    return isInWindow;
  }

  /**
   * Fetch loading date from DCL Master record
   */
  async function fetchLoadingDateFromDcl(dclGuid) {
    if (!dclGuid || !isGuid(dclGuid)) return null;

    try {
      const data = await safeAjax({
        type: "GET",
        url: `${DCL_MASTER_API}(${dclGuid})?$select=cr650_loadingdate`,
        headers: {
          Accept: "application/json;odata.metadata=minimal"
        },
        dataType: "json",
        _withLoader: false
      });

      const loadingDate = data && data.cr650_loadingdate ? data.cr650_loadingdate : null;
      console.log("📅 Loading date from DCL Master:", loadingDate);

      return loadingDate;
    } catch (err) {
      console.error("Failed to fetch loading date:", err);
      return null;
    }
  }

  /* =============================
     2) SAFE AJAX
     ============================= */
  function safeAjax(options) {
    return new Promise((resolve, reject) => {
      options = options || {};
      options.type = options.type || "GET";
      options.contentType = options.contentType || "application/json; charset=utf-8";
      options.dataType = options.dataType || "json";
      options.headers = options.headers || {};
      options.headers.Accept = options.headers.Accept || "application/json;odata.metadata=minimal";

      const toggle = (on) => {
        if (options._withLoader) {
          setLoading(on, options._loaderText || "Loading…");
        }
      };

      function go(token) {
        if (token) options.headers["__RequestVerificationToken"] = token;

        if (w.jQuery && jQuery.ajax) {
          toggle(true);
          jQuery.ajax(options)
            .done((data, text, jqXHR) => {
              try {
                if (typeof w.validateLoginSession === "function") {
                  w.validateLoginSession(data, text, jqXHR, (d2) => {
                    toggle(false);
                    resolve(d2);
                  });
                } else {
                  toggle(false);
                  resolve(data);
                }
              } catch {
                toggle(false);
                resolve(data);
              }
            })
            .fail((err) => {
              toggle(false);
              reject(err);
            });
        } else {
          toggle(true);
          const init = { method: options.type, headers: options.headers };
          if (options.type !== "GET" && options.data) {
            init.body = typeof options.data === "string" ? options.data : JSON.stringify(options.data);
          }

          fetch(options.url, init)
            .then(async (r) => {
              console.log("🔍 Response status:", r.status, r.statusText);
              console.log("🔍 Response headers:", {
                location: r.headers.get("Location"),
                'odata-entityid': r.headers.get("OData-EntityId"),
                'content-type': r.headers.get("Content-Type")
              });

              const t = await r.text();
              console.log("🔍 Response text length:", t ? t.length : 0);
              console.log("🔍 Response text:", t ? t.substring(0, 200) : "(empty)");

              toggle(false);

              if (!r.ok) {
                try { reject(JSON.parse(t)); }
                catch { reject(new Error(t || ("HTTP " + r.status))); }
                return;
              }

              // ✅ IMPROVED: Handle 204 No Content by extracting ID from headers
              if (r.status === 204 || !t) {
                const location = r.headers.get("Location") || r.headers.get("OData-EntityId");
                console.log("📍 Got 204 or empty response, checking Location header:", location);

                if (location) {
                  const match = location.match(/\(([^)]+)\)/);
                  if (match) {
                    const entityId = match[1];
                    console.log("✅ Extracted entity ID from header:", entityId);
                    resolve({ id: entityId, cr650_dcl_loading_planid: entityId });
                    return;
                  }
                }

                resolve({});
                return;
              }

              try {
                const parsed = JSON.parse(t);
                console.log("✅ Parsed JSON response:", parsed);
                resolve(parsed);
              }
              catch { reject(new Error("Response not JSON")); }
            })
            .catch((e) => {
              console.error("❌ Fetch error:", e);
              toggle(false);
              reject(e);
            });
        }
      }

      try {
        if (w.shell && typeof shell.getTokenDeferred === "function") {
          shell.getTokenDeferred()
            .done(go)
            .fail(() => reject({ message: "Token API unavailable" }));
        } else {
          go(null);
        }
      } catch (e) {
        reject({ message: "safeAjax unexpected error", error: e });
      }
    });
  }

  /* =============================
     3) ODATA HELPERS (fetch data)
     ============================= */
  const ORDER_FIELDS = [
    "cr650_dcl_outstanding_reportid",  // ✅ NEW ID field name
    "createdon", "modifiedon", "cr650_year", "cr650_month", "cr650_mon_year",
    "cr650_order_no", "cr650_source_order_number", "cr650_line_number", "cr650_source_line_number",
    "cr650_order_date", "cr650_booked_date", "cr650_date_requested", "cr650_last_release_date",
    "cr650_product_no", "cr650_product_name", "cr650_uom1", "cr650_pack_desc", "cr650_product_pack", "cr650_pack",
    "cr650_original_order_qty", "cr650_shipped_qty1", "cr650_pendingquantity",
    "cr650_onhand_qty", "cr650_available_qty", "cr650_intransit_qty", "cr650_buonhandqty",
    "cr650_qty_mton", "cr650_qty2_bbl",
    "cr650_shipping_status", "cr650_released_flag", "cr650_delivery_no", "cr650_delivery_detail_id",
    "cr650_earliest_pickup_date",
    // ✅ REMOVED: cr650_asn_no, cr650_asn_published_date, cr650_name (not in new table)
    "cr650_customer_number", "cr650_customer_name", "cr650_org_id", "cr650_organization_code", "cr650_cob",
    "cr650_ship_to_address", "cr650_ship_to_address2", "cr650_ship_to_address3", "cr650_ship_to_address4", "cr650_ship_to_city",
    "cr650_whse", "cr650_plant",
    "cr650_order_status", "cr650_order_type",
    "cr650_opmcategory", "cr650_conversionrate"
  ];

  const buildSelect = () => "$select=" + enc(ORDER_FIELDS.join(","));
  const filterByOrderNo = (num) => "$filter=" + enc(`cr650_order_no eq '${num}'`);
  const filterBySourceOrderNo = (num) => "$filter=" + enc(`cr650_source_order_number eq '${num}'`);

  const baseOutstandingQuery = (extra) => {
    const orderby = "$orderby=" + enc("createdon desc");
    const top = "$top=5000";
    return `${OUTSTANDING_API}?${buildSelect()}&${orderby}&${top}&${extra}`;
  };

  function fetchPaged(url, acc = [], withLoaderText) {
    return safeAjax({ type: "GET", url, _withLoader: true, _loaderText: withLoaderText || "Loading data…" })
      .then((data) => {
        const rows = (data && (data.value || data)) || [];
        acc.push(...rows);
        if (data && data["@odata.nextLink"]) {
          return fetchPaged(data["@odata.nextLink"], acc, withLoaderText);
        }
        return acc;
      });
  }

  async function fetchOrderLines(orderNo) {
    let url = baseOutstandingQuery(filterByOrderNo(orderNo));
    let rows = await fetchPaged(url, [], `Loading order ${orderNo}…`);

    if (rows && rows.length) {
      return normalizeOutstandingData(rows);  // ✅ Normalize here!
    }

    url = baseOutstandingQuery(filterBySourceOrderNo(orderNo));
    rows = await fetchPaged(url, [], `Loading order ${orderNo}…`);
    return rows ? normalizeOutstandingData(rows) : [];  // ✅ Normalize here!
  }

  /**
 * Fetch currency code from DCL Master record
 */
  async function fetchCurrencyFromDcl(dclGuid) {
    if (!dclGuid || !isGuid(dclGuid)) {
      console.warn("💱 No valid DCL GUID, using default currency USD");
      return "USD";
    }

    try {
      const data = await safeAjax({
        type: "GET",
        url: `${DCL_MASTER_API}(${dclGuid})?$select=cr650_currencycode`,
        headers: {
          Accept: "application/json;odata.metadata=minimal"
        },
        dataType: "json",
        _withLoader: false
      });

      let currencyCode = data && data.cr650_currencycode ? String(data.cr650_currencycode).trim() : null;

      if (!currencyCode) {
        console.warn("💱 No currency code in DCL Master, defaulting to USD");
        currencyCode = "USD";
      }

      console.log("💱 Currency code from DCL Master:", currencyCode);
      return currencyCode;

    } catch (err) {
      console.error("❌ Failed to fetch currency code:", err);
      return "USD";
    }
  }


  // Shipped / container history - UPDATED WITH DATE FILTERING
  const shippedSelect = () => "$select=" + enc(SHIPPED_FIELDS.join(","));
  const shippedFilterBySo = (num) => "$filter=" + enc(`cr650_order_number eq '${num}'`);
  const shippedBaseQuery = (extra) => {
    const orderby = "$orderby=" + enc("createdon desc");
    const top = "$top=5000";
    return `${SHIPPED_API}?${shippedSelect()}&${orderby}&${top}&${extra}`;
  };
  async function fetchShippedBySo(soNumber) {
    const url = shippedBaseQuery(shippedFilterBySo(soNumber));
    return fetchPaged(url, [], "Fetching shipped history…");
  }

  function tryParseDate(s) {
    if (!s) return NaN;

    // ✅ FIXED: Try DD/MM/YYYY format first (international format)
    const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
    if (m) {
      const [_, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
      const ts = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`);
      if (!Number.isNaN(ts)) return ts;
    }

    // Fallback to standard Date.parse
    const t2 = Date.parse(s);
    return Number.isNaN(t2) ? NaN : t2;
  }

  // ✅ UPDATED: Filter shipped records by loading date window
  function buildShippedIndex(rows) {
    const map = new Map();
    w.__LAST_SHIPPED_ROWS = rows

    for (const r of rows || []) {
      const so = Number(r.cr650_order_number);
      const item = String(r.cr650_item_no || "").trim();
      if (!so || !item) continue;

      // ✅ NEW: Apply date filtering if loading date is available
      if (LOADING_DATE) {
        const rawDate = r.cr650_shipment_date || r.createdon;

        if (!isWithinLoadingDateWindow(rawDate, LOADING_DATE)) {
          console.log(`⏭️ Skipping shipped record - outside date window:`, {
            order: so,
            item: item,
            rawDate
          });
          continue;
        }
      }

      window.__LAST_SHIPPED_ROWS = rows;
      const dn = r.cr650_delivery_note != null ? String(r.cr650_delivery_note).trim() : "";
      const contNo = r.cr650_container_no != null ? String(r.cr650_container_no).trim() : "";
      const whenTs1 = tryParseDate(r.cr650_shipment_date);
      const created = Date.parse(r.createdon || 0) || 0;
      const whenTs = Number.isNaN(whenTs1) ? created : whenTs1;
      const labelDt = Number.isNaN(whenTs1)
        ? new Date(created).toISOString().slice(0, 19).replace("T", " ")
        : r.cr650_shipment_date;

      const key = `${so}|${item}`;
      const arr = map.get(key) || [];
      arr.push({
        dn,
        whenTs,
        label: `${dn} - ${labelDt}`,  // ✅ Changed separator to single dash
        containerNo: contNo
      });
      map.set(key, arr);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => b.whenTs - a.whenTs);
    }

    console.log(`📦 Built shipped index with ${map.size} order-item combinations (filtered by loading date)`);
    w.__LAST_SHIPPED_ROWS = rows
    return map;
  }

  // DCL→Orders
  const dclSelect = () => "$select=" + enc(DCL_ORDER_FIELDS.join(","));
  const dclBaseQuery = () => `${DCL_ORDERS_API}?${dclSelect()}&$orderby=${enc("createdon asc")}`;

  async function fetchAllDclOrders() {
    return fetchPaged(dclBaseQuery(), [], "Reading DCL→orders…");
  }

  async function fetchOrderNumbersForCurrentDcl(dclGuid) {
    if (!dclGuid) return [];
    const all = await fetchAllDclOrders();
    const mine = all.filter(
      r => (r._cr650_dcl_number_value || "").toLowerCase() === dclGuid.toLowerCase()
    );
    const seen = new Set();
    const nums = [];
    for (const r of mine) {
      const n = (r.cr650_order_number || "").trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        nums.push(n);
      }
    }
    return nums;
  }

  // DCL LP rows
  const dclLpQueryForDcl = (dclGuid) =>
    `${DCL_LP_API}?$select=${enc(DCL_LP_FIELDS.join(","))}` +
    `&$filter=${enc(`_cr650_dcl_number_value eq ${dclGuid}`)}` +
    `&$orderby=${enc("createdon asc")}&$top=5000`;

  async function fetchExistingLoadingPlansForCurrentDcl(dclGuid) {
    if (!dclGuid) return [];
    return fetchPaged(dclLpQueryForDcl(dclGuid), [], "Loading saved plan rows…");
  }

  // Container-items fetching
  async function fetchAllContainerItems(dclGuid) {
    const selectCols = DCL_CONTAINER_ITEMS_FIELDS.join(",");

    let url;
    if (dclGuid && isGuid(dclGuid)) {
      const filter = `_cr650_dcl_master_number_value eq ${dclGuid}`;
      url = `${DCL_CONTAINER_ITEMS_API}?$select=${enc(selectCols)}&$filter=${enc(filter)}&$top=5000`;
    } else {
      url = `${DCL_CONTAINER_ITEMS_API}?$select=${enc(selectCols)}&$top=0`;
    }

    return fetchPaged(url, [], "Loading container items…");
  }

  function mapContainerItemRowToState(row) {
    return {
      id: row.cr650_dcl_container_itemsid || row.id,
      lpId: row._cr650_loadingplanitem_value || null,
      quantity: asNum(row.cr650_quantity),
      containerGuid: row._cr650_dcl_number_value || null,
      dclMasterGuid: row._cr650_dcl_master_number_value || null,
      isSplitItem: row.cr650_issplititem === true,
      // Palletized and numberOfPallets are retrieved from Loading Plan row in rebuildAssignmentTable
      palletized: "No",
      numberOfPallets: 0
    };
  }

  // Helper function to distribute pallets proportionally when splitting items
  // Returns an array of pallet counts that sum to the original total
  function distributePallets(originalPallets, quantities) {
    const totalQty = quantities.reduce((a, b) => a + b, 0);
    if (totalQty === 0 || originalPallets <= 0) {
      return quantities.map(() => 0);
    }

    // Calculate proportional pallets for each quantity
    const proportionalPallets = quantities.map(qty =>
      Math.floor(originalPallets * qty / totalQty)
    );

    // Distribute any remainder to ensure total matches
    let remainder = originalPallets - proportionalPallets.reduce((a, b) => a + b, 0);
    let i = 0;
    while (remainder > 0 && i < proportionalPallets.length) {
      proportionalPallets[i]++;
      remainder--;
      i++;
    }

    return proportionalPallets;
  }

  // Creates a container-item row for a given LP row
  async function createContainerItemOnServer(lpId, quantity, containerGuidOpt, isSplitOpt) {
    if (!lpId || !isGuid(lpId)) {
      console.error("createContainerItemOnServer: invalid lpId", lpId);
      throw new Error("Invalid loading plan id");
    }

    const qty = asNum(quantity);

    const payload = {
      cr650_quantity: qty
    };

    if (typeof isSplitOpt === "boolean") {
      payload.cr650_issplititem = !!isSplitOpt;
    }

    payload["cr650_LoadingPlanItem@odata.bind"] = `/cr650_dcl_loading_plans(${lpId})`;

    if (containerGuidOpt && isGuid(containerGuidOpt)) {
      payload["cr650_dcl_number@odata.bind"] = `/cr650_dcl_containers(${containerGuidOpt})`;
    }

    if (CURRENT_DCL_ID && isGuid(CURRENT_DCL_ID)) {
      payload["cr650_dcl_master_number@odata.bind"] = `/cr650_dcl_masters(${CURRENT_DCL_ID})`;
    }

    console.log("Posting container-item", payload);

    try {
      const res = await safeAjax({
        type: "POST",
        url: DCL_CONTAINER_ITEMS_API,
        data: JSON.stringify(payload),
        contentType: "application/json; charset=utf-8",
        headers: {
          Accept: "application/json;odata.metadata=minimal",
          Prefer: "return=representation"
        },
        dataType: "json",
        _withLoader: true,
        _loaderText: "Creating container item…"
      });

      const newId = res && (res.cr650_dcl_container_itemsid || res.id);

      if (!newId) {
        console.log("Container-item created but id not returned (expected 204). Will be picked up on next reload.", res);
        return null;
      }

      return newId;
    } catch (err) {
      console.error("Failed creating container-item for LP row", lpId, err);
      if (err && err.responseText) {
        console.error("Dataverse error (responseText):", err.responseText);
      }
      if (err && err.responseJSON && err.responseJSON.error && err.responseJSON.error.message) {
        console.error("Dataverse error (message):", err.responseJSON.error.message);
      }
      throw err;
    }
  }

  async function patchContainerItem(ciId, fields) {
    if (!ciId) return;

    // ✅ SPECIAL HANDLING: If we're clearing the container lookup
    if (fields["cr650_dcl_number@odata.bind"] === null) {
      // Use DELETE on the navigation property to clear the reference
      try {
        await safeAjax({
          type: "DELETE",
          url: `${DCL_CONTAINER_ITEMS_API}(${ciId})/cr650_dcl_number/$ref`,
          headers: {
            Accept: "application/json;odata.metadata=minimal"
          },
          dataType: "json",
          _withLoader: true,
          _loaderText: "Removing container assignment…"
        });

        console.log("✅ Container assignment cleared via DELETE");
        return;
      } catch (err) {
        // If DELETE fails (e.g., reference doesn't exist), that's OK
        console.warn("DELETE $ref failed (may already be null):", err);
        return;
      }
    }

    // ✅ NORMAL PATCH for other fields
    await safeAjax({
      type: "PATCH",
      url: `${DCL_CONTAINER_ITEMS_API}(${ciId})`,
      data: JSON.stringify(fields),
      contentType: "application/json; charset=utf-8",
      headers: {
        Accept: "application/json;odata.metadata=minimal",
        "If-Match": "*"
      },
      dataType: "json",
      _withLoader: true,
      _loaderText: "Updating container item…"
    });
  }

  async function deleteContainerItem(ciId) {
    if (!ciId) return;
    await safeAjax({
      type: "DELETE",
      url: `${DCL_CONTAINER_ITEMS_API}(${ciId})`,
      headers: {
        Accept: "application/json;odata.metadata=minimal",
        "If-Match": "*"
      },
      dataType: "json",
      _withLoader: true,
      _loaderText: "Deleting container item…"
    });
  }

  /* =============================
     4) PACK / NORMALIZERS
     ============================= */
  function parsePackLiters(packDesc) {
    if (!packDesc) return 0;
    const s = String(packDesc).replace(/\s+/g, "").toUpperCase();

    // Pattern 1: "5x4L" or "5X4L" (with L) → 5 * 4 = 20
    const mMultiWithL = s.match(/(\d+)[X×](\d+(\.\d+)?)L/);
    if (mMultiWithL) return Number(mMultiWithL[1]) * Number(mMultiWithL[2]);

    // Pattern 2: "5x4" or "5X4" (without L) → 5 * 4 = 20  ✅ NEW
    const mMultiNoL = s.match(/^(\d+)[X×](\d+(\.\d+)?)$/);
    if (mMultiNoL) return Number(mMultiNoL[1]) * Number(mMultiNoL[2]);

    // Pattern 3: "20L" or "20 LITER" → 20
    const mSingle = s.match(/(\d+(\.\d+)?)L/);
    if (mSingle) return Number(mSingle[1]);

    // Pattern 4: Just a number "208" → 208
    const mNum = s.match(/(\d+)/);
    return mNum ? Number(mNum[1]) : 0;
  }

  function normalizePack(p) {
    if (!p) return "";
    const s = String(p).trim();
    if (/DRUM/i.test(s)) return "DRUM";
    if (/PAIL/i.test(s)) return "PAIL";
    if (/CARTON|CTN/i.test(s)) return "CARTON";
    if (/IBCS?|TOTE/i.test(s)) return "IBC";
    if (/BULK/i.test(s)) return "BULK";
    return s;
  }


  /* =============================
     6) ITEM CALCS
     ============================= */
  function computeItemData(orderItem, index, itemMaster = {}, shippedIndex = null) {
    const orderNo = orderItem.order_no || "";
    const itemCode = orderItem.product_no || "";
    const description = orderItem.product_name || "";

    const releaseStatus = (String(orderItem.released_flag || "").toUpperCase() === "Y") ? "Y" : "N";

    const packaging = orderItem.pack_desc || orderItem.uom1 || orderItem.pack || "";
    const uomPackSz = parsePackLiters(orderItem.pack_desc);
    const pack = normalizePack(orderItem.pack);

    const orderQty = Number(orderItem.original_order_qty) || 0;
    const loadingQty = orderQty;
    //const pendingQty = isSplitRow ? 0 : (orderQty - loadingQty);
    const pendingQty = orderQty - loadingQty;

    const palletized = "No";
    const numberOfPallets = 0; // for drums only / 4 should be editable 
    const palletsWeight = (palletized === "No") ? 0 : (numberOfPallets * 19.38);

    const totalLiters = loadingQty * uomPackSz;
    const netWeight = totalLiters * 0.89;
    const grossWeight = palletsWeight + netWeight + loadingQty;
    const shippedOpts = [];



    return {
      serverId: null,

      orderNo,
      itemCode,
      description,
      releaseStatus,

      packaging,
      uom: uomPackSz,
      uomSymbol: "L",

      pack,
      OrderQuantity: orderQty,
      LoadingQuantity: loadingQty,
      PendingQuantity: pendingQty,

      palletized,
      numberOfPallets,
      palletsWeight,
      totalLiters,
      netWeight,
      grossWeight,

      _shippedOptions: shippedOpts
    };
  }

  function computeItemDataFromDclLP(lpRow) {
    const releaseStatusYN = formatReleaseStatus(lpRow.cr650_releasestatus);
    const palletizedYesNo = lpRow.cr650_ispalletized ? "Yes" : "No";

    return {
      serverId: lpRow.cr650_dcl_loading_planid || null,

      orderNo: lpRow.cr650_ordernumber || "",
      itemCode: lpRow.cr650_itemcode || "",
      description: lpRow.cr650_itemdescription || "",
      releaseStatus: releaseStatusYN,

      packaging: lpRow.cr650_packagingdetails || "",
      uom: asNum(lpRow.cr650_unitofmeasure),
      uomSymbol: "",

      pack: normalizePack(lpRow.cr650_packagetype || ""),

      OrderQuantity: asNum(lpRow.cr650_orderedquantity),
      LoadingQuantity: asNum(lpRow.cr650_loadedquantity),
      PendingQuantity: asNum(lpRow.cr650_pendingquantity),

      palletized: palletizedYesNo,
      numberOfPallets: asNum(lpRow.cr650_palletcount),
      palletsWeight: asNum(lpRow.cr650_palletweight),

      totalLiters: asNum(lpRow.cr650_totalvolumeorweight),
      netWeight: asNum(lpRow.cr650_netweightkg),
      grossWeight: asNum(lpRow.cr650_grossweightkg),

      // Loading Plan page: hide finance/container/HS (AR report will handle)


      _shippedOptions: []
    };
  }

  /* =============================
     7) TABLE RENDERING (LOADING PLAN)
     ============================= */
  function makeRowEl(item, index) {
    const tr = d.createElement("tr");
    tr.classList.add("lp-data-row");

    tr.innerHTML = `
    <td class="sn">${index + 1}</td>

    <td class="controls">
      <button class="btn btn-outline btn-sm lp-edit" type="button">Edit</button>
    </td>

    <td class="order-no ce">${escapeHtml(item.orderNo)}</td>
    <td class="item-code ce">${escapeHtml(item.itemCode)}</td>
    <td class="description ce">${escapeHtml(item.description)}</td>
    <td class="release-status-cell">
      <select class="release-status-select" disabled>
        <option value="Y" ${item.releaseStatus === "Y" ? "selected" : ""}>Y</option>
        <option value="N" ${item.releaseStatus === "N" ? "selected" : ""}>N</option>
      </select>
    </td>
    <td class="packaging ce">${escapeHtml(item.packaging)}</td>

    <td class="uom ce-num">${fmt2(item.uom)}</td>
    <td class="pack ce">${escapeHtml(item.pack)}</td>

    <td class="order-qty ce-num">${fmt2(item.OrderQuantity)}</td>

    <td class="loading-qty-cell">
      <input type="number" class="loading-qty" min="0" value="${fmt2(item.LoadingQuantity)}"
             style="width:100px" disabled>
    </td>

    <td class="pending-qty ce-num">${fmt2(item.PendingQuantity)}</td>

    <td class="total-liters ce-num">${fmt2(item.totalLiters)}</td>
    <td class="net-weight ce-num">${fmt2(item.netWeight)}</td>
    <td class="gross-weight ce-num">${fmt2(item.grossWeight)}</td>


    <td class="row-actions">
      <button class="btn btn-danger btn-sm row-remove" type="button">Remove</button>
    </td>
  `;
    return tr;
  }

  /* =============================
     8) RECALC / TOTALS / MASTER PATCH
     ============================= */

  /**
   * Recalculate derived values for a loading plan row
   * Formulas:
   *   UOM = parse from packing (e.g., 30x4 = 120)
   *   Pending Quantity = Order Quantity − Loading Quantity
   *   Total Liters = Loading Quantity × UOM
   *   Net Weight = Total Liters × DENSITY (1.07 for COOLANT, 0.9 otherwise)
   *   Pallet Weight = 0 if Palletized="No", else Number of Pallets × 19.38
   *   Gross Weight = Pallet Weight + Net Weight + Loading Quantity (unless manually overridden)
   */
  function recalcRow(tr) {
    if (!tr) return;

    // Get cell references
    const packagingCell = tr.querySelector(".packaging");
    const uomCell = tr.querySelector(".uom");
    const descriptionCell = tr.querySelector(".description");
    const orderQtyCell = tr.querySelector(".order-qty");
    const loadingQtyInput = tr.querySelector(".loading-qty");
    const pendingQtyCell = tr.querySelector(".pending-qty");
    const totalLitersCell = tr.querySelector(".total-liters");
    const netWeightCell = tr.querySelector(".net-weight");
    const grossWeightCell = tr.querySelector(".gross-weight");

    // Parse values
    const packaging = (packagingCell?.textContent || "").trim();
    const description = (descriptionCell?.textContent || "").trim().toUpperCase();
    const orderQty = asNum(orderQtyCell?.textContent);
    const loadingQty = asNum(loadingQtyInput?.value);

    // Calculate UOM from packaging (e.g., "30x4" = 120)
    const uom = parsePackLiters(packaging);
    if (uomCell) uomCell.textContent = fmt2(uom);

    // Note: Pending Quantity is calculated at the group level in recomputeTotals()
    // to correctly handle split items (same order+item across multiple rows)
    // Individual row calculation removed to avoid double-counting issues

    // Total Liters = Loading Quantity × UOM
    // Skip if user has manually overridden the value
    if (totalLitersCell && !totalLitersCell.dataset.manualOverride) {
      const totalLiters = loadingQty * uom;
      totalLitersCell.textContent = fmt2(totalLiters);
    }
    const totalLiters = asNum(totalLitersCell?.textContent);

    // Net Weight = Total Liters × DENSITY
    // DENSITY = 1.07 if description contains "COOLANT", else 0.9
    // Skip if user has manually overridden the value
    if (netWeightCell && !netWeightCell.dataset.manualOverride) {
      const density = description.includes("COOLANT") ? 1.07 : 0.9;
      const netWeight = totalLiters * density;
      netWeightCell.textContent = fmt2(netWeight);
    }
    const netWeight = asNum(netWeightCell?.textContent);

    // Gross Weight = Net Weight + Loading Quantity (carton weight)
    // Skip if user has manually overridden the value
    if (grossWeightCell && !grossWeightCell.dataset.manualOverride) {
      const grossWeight = netWeight + loadingQty;
      grossWeightCell.textContent = fmt2(grossWeight);
    }
  }

  function recalcAllRows() {
    QA("#itemsTableBody tr.lp-data-row").forEach(recalcRow);
  }

  function renumberRows() {
    const rows = QA("#itemsTableBody tr.lp-data-row");
    rows.forEach((tr, i) => {
      const snCell = tr.querySelector(".sn");
      if (snCell) {
        snCell.textContent = String(i + 1);
      }
    });
  }

  async function patchDclMasterTotals(totals) {
    if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) return;

    const payload = {
      cr650_totalitems: totals.totalItems,
      cr650_totalorderquantity: totals.totalOrderQty,
      cr650_totalloadingquantity: totals.totalLoadingQty,
      cr650_totalnetweight: totals.totalNet,
      cr650_totalgrossweight: totals.totalGross
    };

    try {
      await safeAjax({
        type: "PATCH",
        url: `${DCL_MASTER_API}(${CURRENT_DCL_ID})`,
        data: JSON.stringify(payload),
        contentType: "application/json; charset=utf-8",
        headers: {
          Accept: "application/json;odata.metadata=minimal",
          "If-Match": "*"
        },
        dataType: "json",
        _withLoader: true,
        _loaderText: "Updating DCL totals…"
      });
    } catch (err) {
      console.warn("Failed to PATCH DCL master totals", err);
    }
  }

  async function loadAndDisplayDclNumber(dclGuid) {
    if (!dclGuid || !isGuid(dclGuid)) {
      setText("#dclNumber", "-");
      return;
    }

    try {
      const data = await safeAjax({
        type: "GET",
        url: `${DCL_MASTER_API}(${dclGuid})?$select=cr650_dclnumber`,
        headers: {
          Accept: "application/json;odata.metadata=minimal"
        },
        dataType: "json",
        _withLoader: false // Don't show loading bar for this quick fetch
      });

      const dclNumber = data && data.cr650_dclnumber ? data.cr650_dclnumber : "-";
      setText("#dclNumber", dclNumber);

      console.log("DCL Number loaded:", dclNumber);
    } catch (err) {
      console.error("Failed to load DCL number:", err);
      setText("#dclNumber", "-");
    }
  }

  function recomputeTotals() {
    const rows = QA("#itemsTableBody tr.lp-data-row");

    let totalItems = rows.length;
    let totalLoadingQty = 0;
    let totalNet = 0;
    let totalGross = 0;

    // Group rows by order number + item code to avoid double-counting Order Qty for split items
    const orderItemGroups = new Map();

    rows.forEach((r) => {
      const orderNo = (r.querySelector(".order-no")?.textContent || "").trim();
      const itemCode = (r.querySelector(".item-code")?.textContent || "").trim();
      const orderQty = asNum(r.querySelector(".order-qty")?.textContent);
      const loadingQty = asNum(r.querySelector(".loading-qty")?.value);
      const netWeight = asNum(r.querySelector(".net-weight")?.textContent);
      const grossWeight = asNum(r.querySelector(".gross-weight")?.textContent);

      // Create a unique key for order + item combination
      const key = `${orderNo}|${itemCode}`;

      if (!orderItemGroups.has(key)) {
        orderItemGroups.set(key, {
          orderQty: orderQty, // Only count order qty once per unique order+item
          totalLoadingQty: 0,
          totalNet: 0,
          totalGross: 0
        });
      }

      const group = orderItemGroups.get(key);
      group.totalLoadingQty += loadingQty;
      group.totalNet += netWeight;
      group.totalGross += grossWeight;

      totalLoadingQty += loadingQty;
      totalNet += netWeight;
      totalGross += grossWeight;
    });

    // Calculate total order qty (unique, not double-counting splits)
    let totalOrderQty = 0;
    orderItemGroups.forEach((group) => {
      totalOrderQty += group.orderQty;
    });

    // Now update pending qty for each row based on its group
    rows.forEach((r) => {
      const orderNo = (r.querySelector(".order-no")?.textContent || "").trim();
      const itemCode = (r.querySelector(".item-code")?.textContent || "").trim();
      const key = `${orderNo}|${itemCode}`;
      const group = orderItemGroups.get(key);

      if (group) {
        const pendingQtyCell = r.querySelector(".pending-qty");
        if (pendingQtyCell) {
          // Pending = Order Qty - Total Loading Qty for this order+item group
          const pendingQty = group.orderQty - group.totalLoadingQty;
          pendingQtyCell.textContent = fmt2(Math.max(0, pendingQty));
        }
      }
    });

    // Calculate total pending qty
    const totalPendingQty = Math.max(0, totalOrderQty - totalLoadingQty);

    setText("#totalItems", totalItems);
    setText("#totalOrderQty", fmt2(totalOrderQty));
    setText("#totalLoadingQty", fmt2(totalLoadingQty));
    setText("#totalNetWeight", `${fmt2(totalNet)} kg`);
    setText("#totalGrossWeight", `${fmt2(totalGross)} kg`);

    setText("#totalQuantity", fmt2(totalLoadingQty));
    setText("#totalWeight", fmt2(totalGross));

    setText("#totalNetWeight2", fmt2(totalNet));
    setText("#totalGrossWeight2", fmt2(totalGross));

    renumberRows();

    patchDclMasterTotals({
      totalItems,
      totalOrderQty,
      totalLoadingQty,
      totalNet,
      totalGross
    });


    renderContainerSummaries();
  }


  /* =============================
     9) EDIT + SAVE/DELETE (LOADING PLAN ROW)
     ============================= */
  const EDITABLE_TEXT_CELLS = [
    ".order-no",
    ".item-code",
    ".description",
    ".packaging",
    ".uom",
    ".pack",
    ".order-qty",
    ".pending-qty",
    ".total-liters",
    ".net-weight",
    ".gross-weight"
  ];


  function enableContentEditable(td) {
    if (!td) return;
    td.dataset.orig = td.textContent;
    td.contentEditable = "true";
    td.classList.add("ce-editing");
    td.addEventListener("keydown", preventEnter);
  }
  function disableContentEditable(td, keepValue) {
    if (!td) return;
    td.contentEditable = "false";
    td.classList.remove("ce-editing");
    td.removeEventListener("keydown", preventEnter);
    if (!keepValue && td.dataset.orig != null) {
      td.textContent = td.dataset.orig;
    }
    delete td.dataset.orig;
  }
  function preventEnter(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      e.target.blur();
    }
  }
  function getCell(tr, sel) { return tr.querySelector(sel); }

  function beginRowEdit(tr) {
    // Enable contentEditable cells
    EDITABLE_TEXT_CELLS.forEach((cls) => {
      enableContentEditable(getCell(tr, cls));
    });

    // Enable input fields
    const loadingQtyInput = tr.querySelector(".loading-qty");
    if (loadingQtyInput) loadingQtyInput.disabled = false;

    // Enable select dropdowns
    const palletizedSelect = tr.querySelector(".palletized-select");
    if (palletizedSelect) palletizedSelect.disabled = false;

    const releaseStatusSelect = tr.querySelector(".release-status-select");
    if (releaseStatusSelect) releaseStatusSelect.disabled = false;

    // Update control buttons
    const ctrl = tr.querySelector(".controls");
    if (ctrl) {
      ctrl.innerHTML = `
      <div class="row-edit-controls" style="display:flex;gap:6px;">
        <button class="btn btn-success btn-sm row-save" type="button">Save</button>
        <button class="btn btn-secondary btn-sm row-cancel" type="button">Cancel</button>
      </div>
    `;
    }
  }

  function cancelRowEdits(tr) {
    EDITABLE_TEXT_CELLS.forEach((cls) => {
      disableContentEditable(getCell(tr, cls), false);
    });

    const loadingQtyInput = tr.querySelector(".loading-qty");
    if (loadingQtyInput) loadingQtyInput.disabled = true;

    const palletizedSelect = tr.querySelector(".palletized-select");
    if (palletizedSelect) palletizedSelect.disabled = true;

    const releaseStatusSelect = tr.querySelector(".release-status-select");
    if (releaseStatusSelect) releaseStatusSelect.disabled = true;

    const ctrl = tr.querySelector(".controls");
    if (ctrl) {
      ctrl.innerHTML = `<button class="btn btn-outline btn-sm lp-edit" type="button">Edit</button>`;
    }

    recalcRow(tr);
  }

  async function ensureContainerItemsForCurrentDcl(freshLpRowsOpt) {
    if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
      console.warn("ensureContainerItemsForCurrentDcl: no valid CURRENT_DCL_ID");
      return;
    }

    const dclLower = CURRENT_DCL_ID.toLowerCase();

    // MODE A: called with no LP rows => just load what exists for this DCL
    if (!Array.isArray(freshLpRowsOpt) || !freshLpRowsOpt.length) {
      const allCi = await fetchAllContainerItems(CURRENT_DCL_ID);

      const relevantCi = (allCi || []).filter(ci => {
        const masterLower = String(ci._cr650_dcl_master_number_value || "").toLowerCase();
        return masterLower === dclLower;
      });

      DCL_CONTAINER_ITEMS_STATE = relevantCi.map(mapContainerItemRowToState);
      return;
    }

    // MODE B: called from Start Allocation with the fresh LP rows
    const lpRows = freshLpRowsOpt;

    const lpIdSet = new Set(
      (lpRows || [])
        .map(r => (r.cr650_dcl_loading_planid || "").toLowerCase())
        .filter(Boolean)
    );

    // 1) Load existing container-items for this DCL
    const allCiBefore = await fetchAllContainerItems(CURRENT_DCL_ID);

    const ciByLp = new Map();
    (allCiBefore || []).forEach(ci => {
      const lpIdLower = String(ci._cr650_loadingplanitem_value || "").toLowerCase();
      if (!lpIdLower) return;
      if (!ciByLp.has(lpIdLower)) {
        ciByLp.set(lpIdLower, []);
      }
      ciByLp.get(lpIdLower).push(ci);
    });

    // 2) Create missing container-item rows (one per LP row with loaded quantity)
    let createdCount = 0;
    for (const lpRow of (lpRows || [])) {
      const lpId = lpRow.cr650_dcl_loading_planid;
      if (!lpId) continue;
      const lpIdLower = lpId.toLowerCase();

      const existingForLp = ciByLp.get(lpIdLower) || [];
      if (existingForLp.length) continue;

      const qty = asNum(lpRow.cr650_loadedquantity);
      if (!qty) continue;

      try {
        await createContainerItemOnServer(lpId, qty, null, false);
        createdCount++;
      } catch (err) {
        console.error("ensureContainerItemsForCurrentDcl: failed to create CI for LP", lpId, err);
      }
    }

    // ✅ 3) Wait a bit if we created records, to allow server to commit
    if (createdCount > 0) {
      console.log(`Created ${createdCount} container items. Waiting for server commit...`);
      await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds
    }

    // ✅ 4) Re-fetch with retry logic
    let allCiAfter = [];
    let retries = 3;

    while (retries > 0) {
      allCiAfter = await fetchAllContainerItems(CURRENT_DCL_ID);

      const relevantCiFinal = (allCiAfter || []).filter(ci => {
        const masterLower = String(ci._cr650_dcl_master_number_value || "").toLowerCase();
        const lpLower = String(ci._cr650_loadingplanitem_value || "").toLowerCase();
        return masterLower === dclLower || (lpLower && lpIdSet.has(lpLower));
      });

      // ✅ Check if we got all expected container items
      if (relevantCiFinal.length >= lpRows.length || createdCount === 0) {
        DCL_CONTAINER_ITEMS_STATE = relevantCiFinal.map(mapContainerItemRowToState);
        console.log(`Successfully loaded ${DCL_CONTAINER_ITEMS_STATE.length} container items into state`);
        return;
      }

      // ✅ Not all items loaded yet, wait and retry
      retries--;
      if (retries > 0) {
        console.log(`Only ${relevantCiFinal.length} of ${lpRows.length} items loaded. Retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
      }
    }

    // ✅ Final attempt - use whatever we got
    const relevantCiFinal = (allCiAfter || []).filter(ci => {
      const masterLower = String(ci._cr650_dcl_master_number_value || "").toLowerCase();
      const lpLower = String(ci._cr650_loadingplanitem_value || "").toLowerCase();
      return masterLower === dclLower || (lpLower && lpIdSet.has(lpLower));
    });

    DCL_CONTAINER_ITEMS_STATE = relevantCiFinal.map(mapContainerItemRowToState);
    console.log(`Loaded ${DCL_CONTAINER_ITEMS_STATE.length} container items into state (after retries)`);
  }

  async function refreshContainerItemsState() {
    const all = await fetchAllContainerItems(CURRENT_DCL_ID);

    DCL_CONTAINER_ITEMS_STATE = (all || [])
      .filter(item => {
        const dclMatch =
          String(item._cr650_dcl_master_number_value || "").toLowerCase() ===
          CURRENT_DCL_ID.toLowerCase();

        const lpLinked =
          String(item._cr650_loadingplanitem_value || "").length > 0;

        return dclMatch || lpLinked;
      })
      .map(mapContainerItemRowToState);

    console.log(
      "✅ refreshContainerItemsState →",
      DCL_CONTAINER_ITEMS_STATE.length,
      "items"
    );
  }


  async function saveRowEdits(tr) {
    setLoading(true, "Saving changes...");

    // Disable contentEditable cells
    EDITABLE_TEXT_CELLS.forEach((cls) => {
      disableContentEditable(getCell(tr, cls), true);
    });

    // Disable input fields
    const loadingQtyInput = tr.querySelector(".loading-qty");
    if (loadingQtyInput) loadingQtyInput.disabled = true;


    // Disable select dropdowns
    const palletizedSelect = tr.querySelector(".palletized-select");
    if (palletizedSelect) palletizedSelect.disabled = true;


    // Restore Edit button
    const ctrl = tr.querySelector(".controls");
    if (ctrl) {
      ctrl.innerHTML = `<button class="btn btn-outline btn-sm lp-edit" type="button">Edit</button>`;
    }

    // Don't call recalcRow - preserve user's manually edited values
    recomputeTotals();

    try {
      let serverId = tr.dataset.serverId;

      // ✅ NEW: If no serverId, try to find it before deciding to create or update
      if (!serverId || !isGuid(serverId)) {
        console.log("⚠️ Row has no server ID, attempting to find existing record...");

        const orderNo = (tr.querySelector(".order-no")?.textContent || "").trim();
        const itemCode = (tr.querySelector(".item-code")?.textContent || "").trim();

        if (orderNo && itemCode && CURRENT_DCL_ID) {
          // Try to find this record in Dataverse
          const escapedOrder = orderNo.replace(/'/g, "''");
          const escapedItem = itemCode.replace(/'/g, "''");

          const findUrl =
            `${DCL_LP_API}?$filter=` +
            `_cr650_dcl_number_value eq ${CURRENT_DCL_ID} and ` +
            `cr650_ordernumber eq '${escapedOrder}' and ` +
            `cr650_itemcode eq '${escapedItem}'` +
            `&$top=1` +
            `&$select=cr650_dcl_loading_planid`;

          try {
            const findRes = await safeAjax({
              type: "GET",
              url: findUrl,
              headers: { Accept: "application/json;odata.metadata=minimal" },
              dataType: "json",
              _withLoader: false
            });

            if (findRes && findRes.value && findRes.value.length > 0) {
              serverId = findRes.value[0].cr650_dcl_loading_planid;
              tr.dataset.serverId = serverId;
              console.log("✅ Found existing record ID:", serverId);
            } else {
              console.log("ℹ️ No existing record found, will create new");
            }
          } catch (err) {
            console.warn("Could not search for existing record:", err);
          }
        }
      }

      // Now decide: update or create
      if (serverId && isGuid(serverId)) {
        console.log("🔄 Updating existing row:", serverId);
        await updateServerRowFromTr(tr, CURRENT_DCL_ID);
      } else {
        console.log("🆕 Creating new row (no existing record found)");
        await createServerRowFromTr(tr, CURRENT_DCL_ID);
      }

      await ensureContainerItemsForCurrentDcl();
      rebuildAssignmentTable();
      renderContainerSummaries();
      refreshAIAnalysis();

    } catch (e) {
      console.error("Save failed", e);
      showValidation("error", "Failed to persist row.");
      throw e;
    } finally {
      setLoading(false);
    }
  }

  function attachRowEvents(tbody) {
    if (!tbody || tbody._wired) return;
    tbody._wired = true;

    tbody.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr.lp-data-row");
      if (!tr) return;

      if (e.target.classList.contains("lp-edit")) {
        beginRowEdit(tr);

      } else if (e.target.classList.contains("row-save")) {
        await saveRowEdits(tr);

      } else if (e.target.classList.contains("row-cancel")) {
        cancelRowEdits(tr);

      } else if (e.target.classList.contains("row-remove")) {
        try {
          const serverId = tr.dataset.serverId;
          const containerItemId = tr.dataset.containerItemId; // Only exists for splits

          // ✅ ALWAYS check state to count CIs for this LP
          const allCIsForThisLP = serverId ? DCL_CONTAINER_ITEMS_STATE.filter(
            ci => ci.lpId && ci.lpId.toLowerCase() === serverId.toLowerCase()
          ) : [];

          const ciCount = allCIsForThisLP.length;

          console.log(`📊 Deleting row for LP ${serverId?.substring(0, 8)}... (has ${ciCount} CI(s))`);

          if (ciCount === 0) {
            // ✅ CASE 1: Pre-allocation item (no CIs) → Delete LP only
            console.log("🗑️ Pre-allocation item - deleting LP only");
            if (serverId) {
              await deleteServerRow(serverId);
            }
            showValidation("success", "✅ Item deleted successfully.");

          } else if (ciCount === 1) {
            // ✅ CASE 2: Normal allocated item (1 CI) → Delete CI then LP
            console.log("🗑️ Normal allocated item - deleting CI + LP");

            const ciToDelete = allCIsForThisLP[0];
            await deleteContainerItem(ciToDelete.id);

            // Remove from state
            const idx = DCL_CONTAINER_ITEMS_STATE.findIndex(ci => ci.id === ciToDelete.id);
            if (idx >= 0) {
              DCL_CONTAINER_ITEMS_STATE.splice(idx, 1);
            }

            // Then delete LP
            if (serverId) {
              await deleteServerRow(serverId);
            }

            showValidation("success", "✅ Item deleted successfully.");

          } else {
            // ✅ CASE 3: Split item (2+ CIs) → Delete specific CI only
            console.log(`🗑️ Split item (${ciCount} splits) - deleting one CI`);

            if (!containerItemId) {
              showValidation("error", "Cannot determine which split to delete");
              return;
            }

            await deleteContainerItem(containerItemId);

            // Remove from state
            const idx = DCL_CONTAINER_ITEMS_STATE.findIndex(ci => ci.id === containerItemId);
            if (idx >= 0) {
              DCL_CONTAINER_ITEMS_STATE.splice(idx, 1);
            }

            // Check remaining
            const remaining = DCL_CONTAINER_ITEMS_STATE.filter(
              ci => ci.lpId && serverId && ci.lpId.toLowerCase() === serverId.toLowerCase()
            );

            if (remaining.length === 0 && serverId) {
              console.log("🗑️ Last split - deleting LP too");
              await deleteServerRow(serverId);
              showValidation("success", "✅ Last split deleted. Item removed from loading plan.");
            } else {
              showValidation("success", `✅ Split deleted. ${remaining.length} split(s) remaining.`);
            }
          }

          // UI cleanup
          tr.remove();
          recalcAllRows();
          recomputeTotals();

          await ensureContainerItemsForCurrentDcl();
          rebuildAssignmentTable();
          renderContainerCards();
          renderContainerSummaries();
          refreshAIAnalysis();

        } catch (err) {
          console.error("DELETE failed", err);
          showValidation("error", "❌ Failed to delete: " + (err.responseJSON?.error?.message || err.message));
        }
      }
    });

    // ✅ UPDATED: Trigger recalc for Loading Qty, Unit Price, AND # Pallets
    tbody.addEventListener("input", (e) => {
      const row = e.target.closest("tr.lp-data-row");
      if (!row) return;

      const tdCE = e.target.closest("td.ce-editing");

      // ✅ NEW: Handle packaging changes
      if (tdCE && tdCE.classList.contains("packaging")) {
        const packagingText = tdCE.textContent.trim();
        const newUom = parsePackLiters(packagingText);

        const uomCell = row.querySelector(".uom");
        if (uomCell) {
          uomCell.textContent = fmt2(newUom);
        }

        recalcRow(row);
        recomputeTotals();
      }

      // ✅ NEW: Handle pack type changes
      if (tdCE && tdCE.classList.contains("pack")) {
        console.log("📦 Pack type changed to:", tdCE.textContent.trim());
        recalcRow(row);
        recomputeTotals();
      }

      // ✅ NEW: Handle description changes (for COOLANT detection)
      if (tdCE && tdCE.classList.contains("description")) {
        console.log("📝 Description changed - recalculating for COOLANT detection");
        recalcRow(row);
        recomputeTotals();
      }

      // ✅ NEW: Handle order qty and UOM changes
      if (tdCE && tdCE.classList.contains("order-qty")) {
        recalcRow(row);
        recomputeTotals();
      }

      if (tdCE && tdCE.classList.contains("uom")) {
        recalcRow(row);
        recomputeTotals();
      }

      // ✅ NEW: Also trigger recalc when # Pallets is edited
      if (e.target.classList.contains("loading-qty") ||
        (tdCE && tdCE.classList.contains("pallets"))) {  // ✅ Added this line
        recalcRow(row);
        recomputeTotals();
      }
    });

    tbody.addEventListener("change", async (e) => {
      const row = e.target.closest("tr.lp-data-row");
      if (!row) return;

      if (e.target.classList.contains("palletized-select")) {
        console.log("🔄 Dropdown changed:", e.target.className, "→", e.target.value);
        recalcRow(row);
        recomputeTotals();
        // Auto-save to Dataverse
        if (row.dataset.serverId && CURRENT_DCL_ID) {
          try {
            await updateServerRowFromTr(row, CURRENT_DCL_ID);
            console.log("✅ Auto-saved after palletized change");
          } catch (err) {
            console.error("❌ Auto-save failed:", err);
          }
        }
      }

      // Auto-save when release status changes
      if (e.target.classList.contains("release-status-select")) {
        console.log("🔄 Release status changed:", e.target.value);
        // Auto-save to Dataverse
        if (row.dataset.serverId && CURRENT_DCL_ID) {
          try {
            await updateServerRowFromTr(row, CURRENT_DCL_ID);
            console.log("✅ Auto-saved after release status change");
          } catch (err) {
            console.error("❌ Auto-save failed:", err);
          }
        }
      }

      // Auto-save when loading quantity changes
      if (e.target.classList.contains("loading-qty")) {
        recalcRow(row);
        recomputeTotals();
        if (row.dataset.serverId && CURRENT_DCL_ID) {
          try {
            await updateServerRowFromTr(row, CURRENT_DCL_ID);
            console.log("✅ Auto-saved after loading qty change");
          } catch (err) {
            console.error("❌ Auto-save failed:", err);
          }
        }
      }
    });

    tbody.addEventListener("blur", async (e) => {
      const row = e.target.closest("tr.lp-data-row");
      if (!row) return;

      let shouldAutoSave = false;

      // Handle packaging blur
      const packagingTd = e.target.closest("td.packaging");
      if (packagingTd && packagingTd.isContentEditable) {
        recalcRow(row);
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle pack blur
      const packTd = e.target.closest("td.pack");
      if (packTd && packTd.isContentEditable) {
        console.log("📦 Pack type finalized:", packTd.textContent.trim());
        recalcRow(row);
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle order-qty blur
      const orderQtyTd = e.target.closest("td.order-qty");
      if (orderQtyTd && orderQtyTd.isContentEditable) {
        recalcRow(row);
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle pallets (# of pallets) blur
      const palletsTd = e.target.closest("td.pallets");
      if (palletsTd && palletsTd.isContentEditable) {
        recalcRow(row);
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle description blur (for COOLANT detection)
      const descTd = e.target.closest("td.description");
      if (descTd && descTd.isContentEditable) {
        recalcRow(row);
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle UOM blur
      const uomTd = e.target.closest("td.uom");
      if (uomTd && uomTd.isContentEditable) {
        recalcRow(row);
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle total-liters blur - mark as manually overridden to prevent recalculation
      const totalLitersTd = e.target.closest("td.total-liters");
      if (totalLitersTd && totalLitersTd.isContentEditable) {
        totalLitersTd.dataset.manualOverride = "true";
        console.log("📝 Total liters manually set to:", totalLitersTd.textContent.trim());
        recalcRow(row);  // Recalc dependent fields (net weight, gross weight)
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle net-weight blur - mark as manually overridden to prevent recalculation
      const netWeightTd = e.target.closest("td.net-weight");
      if (netWeightTd && netWeightTd.isContentEditable) {
        netWeightTd.dataset.manualOverride = "true";
        console.log("📝 Net weight manually set to:", netWeightTd.textContent.trim());
        recalcRow(row);  // Recalc dependent fields (gross weight)
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Handle gross weight blur - mark as manually overridden to prevent recalculation
      const grossWeightTd = e.target.closest("td.gross-weight");
      if (grossWeightTd && grossWeightTd.isContentEditable) {
        // Mark as manually overridden so recalcRow won't overwrite user's value
        grossWeightTd.dataset.manualOverride = "true";
        console.log("📝 Gross weight manually set to:", grossWeightTd.textContent.trim());
        recomputeTotals();
        shouldAutoSave = true;
      }

      // Auto-save to Dataverse if any trigger field was edited
      if (shouldAutoSave && row.dataset.serverId && CURRENT_DCL_ID) {
        try {
          await updateServerRowFromTr(row, CURRENT_DCL_ID);
          console.log("✅ Auto-saved after field blur");
        } catch (err) {
          console.error("❌ Auto-save failed:", err);
        }
      }

      const td = e.target.closest("td.item-code");
    }, true);
  }

  function buildPayloadFromRow(tr, dclGuid) {
    const getNumText = (sel) => asNum(tr.querySelector(sel)?.textContent);
    const getNumVal = (sel) => asNum(tr.querySelector(sel)?.value);

    // ─────────────────────────────────────
    // BASIC ORDER & ITEM INFO
    // ─────────────────────────────────────
    const orderNumber = (tr.querySelector(".order-no")?.textContent || "").trim();
    const itemCode = (tr.querySelector(".item-code")?.textContent || "").trim();
    const desc = (tr.querySelector(".description")?.textContent || "").trim();
    const relStatusDisp = (tr.querySelector(".release-status-select")?.value || "N").trim();
    const packaging = (tr.querySelector(".packaging")?.textContent || "").trim();
    const uomNumeric = (tr.querySelector(".uom")?.textContent || "").trim();
    const packType = (tr.querySelector(".pack")?.textContent || "").trim();

    // ─────────────────────────────────────
    // QUANTITIES
    // ─────────────────────────────────────
    const ordQty = getNumText(".order-qty");
    const loadQty = getNumVal(".loading-qty");
    const pendQty = getNumText(".pending-qty");

    // ─────────────────────────────────────
    // PALLET & WEIGHT LOGIC
    // ─────────────────────────────────────
    const palletizedSel = (tr.querySelector(".palletized-select")?.value || "No").trim();
    const palletCount = getNumText(".pallets");
    const palletWeight = getNumText(".pallets-weight");

    const totalVol = getNumText(".total-liters");
    const netW = getNumText(".net-weight");
    const grossW = getNumText(".gross-weight");

    // ─────────────────────────────────────
    // PAYLOAD (LOGISTICS ONLY)
    // ─────────────────────────────────────
    const payload = {
      cr650_ordernumber: orderNumber,
      cr650_itemcode: itemCode,
      cr650_itemdescription: desc,
      cr650_releasestatus: parseReleaseStatusDisplayToRaw(relStatusDisp),
      cr650_packagingdetails: packaging,
      cr650_unitofmeasure: uomNumeric,
      cr650_packagetype: packType,

      cr650_orderedquantity: ordQty,
      cr650_loadedquantity: loadQty,
      cr650_pendingquantity: pendQty,

      cr650_ispalletized: palletizedSel.toLowerCase() === "yes",
      cr650_palletcount: palletCount,
      cr650_palletweight: palletWeight,

      cr650_totalvolumeorweight: totalVol,
      cr650_netweightkg: netW,
      cr650_grossweightkg: grossW
    };

    // ─────────────────────────────────────
    // DCL MASTER BINDING
    // ─────────────────────────────────────
    if (dclGuid && isGuid(dclGuid)) {
      payload["cr650_dcl_number@odata.bind"] = `/cr650_dcl_masters(${dclGuid})`;
    }

    return payload;
  }

  async function createServerRowFromTr(tr, dclGuid) {
    const payload = buildPayloadFromRow(tr, dclGuid);

    console.log("📤 Creating LP record:", payload);

    const res = await safeAjax({
      type: "POST",
      url: DCL_LP_API,
      data: JSON.stringify(payload),
      contentType: "application/json; charset=utf-8",
      headers: {
        Accept: "application/json;odata.metadata=minimal",
        Prefer: "return=representation"
      },
      dataType: "json",
      _withLoader: true,
      _loaderText: "Saving row…"
    });

    let newId = res && (res.cr650_dcl_loading_planid || res.id);

    // ✅ If ID not in response, fetch it back
    if (!newId) {
      console.log("⏳ ID not in response, fetching back...");
      await new Promise(resolve => setTimeout(resolve, 800));

      const orderNo = (tr.querySelector(".order-no")?.textContent || "").trim();
      const itemCode = (tr.querySelector(".item-code")?.textContent || "").trim();

      if (orderNo && itemCode && dclGuid) {
        const escapedOrder = orderNo.replace(/'/g, "''");
        const escapedItem = itemCode.replace(/'/g, "''");

        const fetchUrl =
          `${DCL_LP_API}?$filter=` +
          `_cr650_dcl_number_value eq ${dclGuid} and ` +
          `cr650_ordernumber eq '${escapedOrder}' and ` +
          `cr650_itemcode eq '${escapedItem}'` +
          `&$orderby=createdon desc&$top=1` +
          `&$select=cr650_dcl_loading_planid`;

        const fetchRes = await safeAjax({
          type: "GET",
          url: fetchUrl,
          headers: { Accept: "application/json;odata.metadata=minimal" },
          dataType: "json",
          _withLoader: false
        });

        if (fetchRes && fetchRes.value && fetchRes.value.length > 0) {
          newId = fetchRes.value[0].cr650_dcl_loading_planid;
          console.log("✅ Retrieved ID via fetch:", newId);
        }
      }
    }

    if (newId) {
      tr.dataset.serverId = newId;
      console.log("✅ Record created/found with ID:", newId);
    } else {
      console.warn("⚠️ Could not get server ID - row may be created without ID reference");
    }
  }

  async function updateServerRowFromTr(tr, dclGuid) {
    const serverId = tr.dataset.serverId;
    if (!serverId) {
      return createServerRowFromTr(tr, dclGuid);
    }
    const payload = buildPayloadFromRow(tr, dclGuid);

    console.log("📤 Updating LP record:", serverId, payload);

    try {
      await safeAjax({
        type: "PATCH",
        url: `${DCL_LP_API}(${serverId})`,
        data: JSON.stringify(payload),
        contentType: "application/json; charset=utf-8",
        headers: {
          Accept: "application/json;odata.metadata=minimal",
          "If-Match": "*"
        },
        dataType: "json",
        _withLoader: true,
        _loaderText: "Updating row…"
      });
      console.log("✅ LP record updated successfully");
    } catch (err) {
      console.error("❌ Failed to update LP record:", err);
      throw err;
    }
  }

  async function deleteServerRow(serverId) {
    if (!serverId) return;
    await safeAjax({
      type: "DELETE",
      url: `${DCL_LP_API}(${serverId})`,
      headers: {
        Accept: "application/json;odata.metadata=minimal",
        "If-Match": "*"
      },
      dataType: "json",
      _withLoader: true,
      _loaderText: "Deleting row…"
    });
  }

  /* =============================
     10) IMPORT ADAPTERS
     ============================= */
  function adaptRawRowToOrderItem(r) {
    return {
      order_no: r.cr650_order_no || r.cr650_source_order_number || "",
      product_no: r.cr650_product_no || "",
      product_name: r.cr650_product_name || "",
      released_flag: String(r.cr650_released_flag || "").toUpperCase(),
      pack_desc: r.cr650_pack_desc || r.cr650_uom1 || r.cr650_pack || "",
      pack: r.cr650_pack || r.cr650_uom1 || r.cr650_pack_desc || "",
      original_order_qty: r.cr650_original_order_qty || 0
    };
  }

  async function appendAndPersistItems(items, tbody) {
    for (let i = 0; i < items.length; i++) {
      const tr = makeRowEl(items[i], QA("#itemsTableBody tr.lp-data-row").length + i);
      tbody.appendChild(tr);

      recalcRow(tr);

      try {
        await createServerRowFromTr(tr, CURRENT_DCL_ID);
      } catch (err) {
        console.error("POST failed for new row", err);
        showValidation("error", "Failed to save new row to server.");
      }
    }

    attachRowEvents(tbody);

    recalcAllRows();
    recomputeTotals();
  }

  async function importUsingYourCalculations(rawRows, itemMaster = {}, shippedIndex = null) {
    const tbody = Q("#itemsTableBody");
    if (!tbody) return;

    const baseCount = QA("#itemsTableBody tr.lp-data-row").length;

    const items = rawRows.map((r, i) =>
      computeItemData(
        adaptRawRowToOrderItem(r),
        baseCount + i,
        itemMaster,
        shippedIndex
      )
    );

    await appendAndPersistItems(items, tbody);
  }

  async function importExistingDclLpRows(lpRows) {
    const tbody = Q("#itemsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // First, collect all unique order numbers from the LP rows
    const orderNumbers = new Set();
    lpRows.forEach(lpRow => {
      const orderNo = lpRow.cr650_ordernumber;
      if (orderNo) orderNumbers.add(orderNo);
    });

    // Fetch shipped history for all these orders
    const shippedIndexMap = new Map();
    for (const orderNo of orderNumbers) {
      try {
        const shippedRows = await fetchShippedBySo(orderNo);
        const shippedIndex = buildShippedIndex(shippedRows || []);
        shippedIndexMap.set(Number(orderNo), shippedIndex);
      } catch (err) {
        console.warn(`Failed to fetch shipped history for order ${orderNo}`, err);
      }
    }

    // ✅ NEW: Fetch container items to check for splits
    let containerItems = [];
    let containerItemsByLp = new Map();
    let containerLookup = new Map();
    window.__SHIPPED_INDEX_MAP = shippedIndexMap;


    try {
      containerItems = await fetchContainerItemsForLpRows(lpRows);
      containerItemsByLp = buildContainerItemsLookup(containerItems);
      const containers = await fetchContainersForCurrentDcl();
      containerLookup = buildContainerLookup(containers);
    } catch (err) {
      console.warn("Failed to fetch container items/containers, using original display", err);
    }

    // ✅ NEW: Process LP rows with split logic
    const displayRows = [];

    lpRows.forEach((lpRow) => {
      const lpId = lpRow.cr650_dcl_loading_planid;
      const lpIdLower = (lpId || "").toLowerCase();

      // ✅ Check if this LP row has container items (splits)
      const ciForThisLp = containerItemsByLp.get(lpIdLower) || [];

      // ✅ CASE 1: NON-SPLIT ITEM (no container items or only 1 container item)
      if (ciForThisLp.length <= 1) {
        const item = computeItemDataFromDclLP(lpRow);

        // Add the shipped options back (original logic)
        const orderNo = Number(lpRow.cr650_ordernumber);
        const itemCode = String(lpRow.cr650_itemcode || "").trim();

        if (orderNo && itemCode) {
          const shippedIndex = shippedIndexMap.get(orderNo);
          if (shippedIndex) {
            const shippedOpts = shippedIndex.get(`${orderNo}|${itemCode}`) || [];
            item._shippedOptions = shippedOpts;

            // IMPORTANT: Check if the current container matches any option
            if (item.containerNumber && shippedOpts.length > 0) {
              const hasMatch = shippedOpts.some(opt => {
                return opt.label === item.containerNumber ||
                  opt.containerNo === item.containerNumber ||
                  opt.dn === item.containerNumber;
              });

              if (!hasMatch) {
                shippedOpts.unshift({
                  dn: item.containerNumber,
                  containerNo: item.containerNumber,
                  whenTs: Date.now(),
                  label: item.containerNumber
                });
              }
            } else if (!item.serverId) {
              // ✅ NEW: For fresh imports (no serverId), clear the container
              item.containerNumber = "";
            }
          }
        }

        displayRows.push(item);
      }
      // ✅ CASE 2: SPLIT ITEM (multiple container items)
      else {
        // Sort container items to maintain consistent order
        ciForThisLp.sort((a, b) => (a.createdon || "").localeCompare(b.createdon || ""));

        ciForThisLp.forEach((ci, splitIndex) => {
          // Create a base item from LP row
          const baseItem = computeItemDataFromDclLP(lpRow);

          // ✅ FIXED: Use correct property name with capital L
          baseItem.LoadingQuantity = ci.cr650_quantity || 0;
          baseItem.PendingQuantity = 0;

          // ✅ Override container with actual container from container item
          const containerGuid = ci._cr650_dcl_number_value;
          if (containerGuid) {
            const container = containerLookup.get(containerGuid.toLowerCase());
            if (container) {
              baseItem.containerNumber = container.cr650_dcl_code || container.cr650_container_type_label || "";
            }
          }

          // ✅ Recalculate weights based on split ratio
          const originalLoadedQty = asNum(lpRow.cr650_loadedquantity);
          const splitQty = ci.cr650_quantity || 0;

          if (originalLoadedQty > 0) {
            const ratio = splitQty / originalLoadedQty;

            // ✅ FIXED: Use correct property names
            baseItem.grossWeight = round2(asNum(lpRow.cr650_grossweightkg) * ratio);
            baseItem.netWeight = round2(asNum(lpRow.cr650_netweightkg) * ratio);
            baseItem.totalLiters = round2(asNum(lpRow.cr650_totalvolumeorweight) * ratio);

          }

          // ✅ Mark split items for visual styling (2nd+ items)
          if (splitIndex > 0) {
            baseItem._isSplitContinuation = true;
            baseItem._splitIndex = splitIndex;
          }

          // ✅ Add container item reference for two-way binding
          baseItem._containerItemId = ci.cr650_dcl_container_itemsid;
          baseItem._containerItemRef = ci;

          // Add shipped options (same as non-split)
          const orderNo = Number(lpRow.cr650_ordernumber);
          const itemCode = String(lpRow.cr650_itemcode || "").trim();

          if (orderNo && itemCode) {
            const shippedIndex = shippedIndexMap.get(orderNo);
            if (shippedIndex) {
              const shippedOpts = shippedIndex.get(`${orderNo}|${itemCode}`) || [];
              baseItem._shippedOptions = shippedOpts;

              if (baseItem.containerNumber && shippedOpts.length > 0) {
                const hasMatch = shippedOpts.some(opt => {
                  return opt.label === baseItem.containerNumber ||
                    opt.containerNo === baseItem.containerNumber ||
                    opt.dn === baseItem.containerNumber;
                });

                if (!hasMatch) {
                  shippedOpts.unshift({
                    dn: baseItem.containerNumber,
                    containerNo: baseItem.containerNumber,
                    whenTs: Date.now(),
                    label: baseItem.containerNumber
                  });
                }
              }
            }
          }

          displayRows.push(baseItem);
        });
      }
    });

    // Render the rows with split item styling
    const frag = d.createDocumentFragment();
    displayRows.forEach((it, displayIndex) => {
      const tr = makeRowEl(it, displayIndex);

      // ✅ Store original LP row ID for reference
      if (it.serverId) {
        tr.dataset.serverId = it.serverId;
      }

      // ✅ Store container item ID for two-way binding
      if (it._containerItemId) {
        tr.dataset.containerItemId = it._containerItemId;
      }

      // ✅ Apply split item styling
      if (it._isSplitContinuation) {
        tr.classList.add("split-continuation-row");
        tr.style.backgroundColor = "#fffbf0";
        tr.style.borderLeft = "3px solid #ffc107";

        // Add arrow prefix to serial number cell
        const serialCell = tr.querySelector(".sn");  // ✅ FIXED class name
        if (serialCell) {
          const currentText = serialCell.textContent;
          serialCell.innerHTML = `<span style="color:#999;margin-right:4px;">↳</span>${escapeHtml(currentText)}`;
        }
      }

      frag.appendChild(tr);
    });

    tbody.appendChild(frag);

    attachRowEvents(tbody);
    // Don't call recalcAllRows() here - we're loading saved values from Dataverse
    // and want to preserve user's manually entered values (like gross weight)
    recomputeTotals();
  }


  /* =============================
     10.1) IMPORT Helpers if split
     ============================= */
  /**
   * ✅ NEW HELPER: Fetch container items for given LP rows
   */
  async function fetchContainerItemsForLpRows(lpRows) {
    if (!lpRows || !lpRows.length) return [];

    const lpIds = lpRows
      .map(lp => lp.cr650_dcl_loading_planid)
      .filter(Boolean);

    if (!lpIds.length) return [];

    // Build filter to fetch container items for these LP rows
    const filterParts = lpIds.map(id => `_cr650_loadingplanitem_value eq ${id}`);
    const filter = filterParts.join(" or ");

    try {
      const url = `${DCL_CONTAINER_ITEMS_API}?$filter=${enc(filter)}&$select=${DCL_CONTAINER_ITEMS_FIELDS.join(",")}`;
      const resp = await fetch(url);
      const data = await resp.json();
      return data.value || [];
    } catch (err) {
      console.error("Failed to fetch container items for LP rows", err);
      return [];
    }
  }

  /**
   * ✅ NEW HELPER: Build container items lookup by LP row ID
   */
  function buildContainerItemsLookup(containerItems) {
    const map = new Map();

    containerItems.forEach(ci => {
      const lpId = ci._cr650_loadingplanitem_value;
      if (!lpId) return;

      const lpIdLower = lpId.toLowerCase();
      if (!map.has(lpIdLower)) {
        map.set(lpIdLower, []);
      }
      map.get(lpIdLower).push(ci);
    });

    return map;
  }

  /**
   * ✅ NEW HELPER: Fetch containers for current DCL
   */
  async function fetchContainersForCurrentDcl() {
    if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) return [];

    try {
      const filter =
        `_cr650_dcl_master_number_value eq guid'${CURRENT_DCL_ID}'`;
      const url = `${DCL_CONTAINERS_API}?$filter=${enc(filter)}`;
      const resp = await fetch(url);
      const data = await resp.json();
      return data.value || [];
    } catch (err) {
      console.error("Failed to fetch containers", err);
      return [];
    }
  }

  /**
   * ✅ NEW HELPER: Build container lookup by GUID
   */
  function buildContainerLookup(containers) {
    const map = new Map();

    containers.forEach(c => {
      const id = c.cr650_dcl_containerid;
      if (id) {
        map.set(id.toLowerCase(), c);

        // Add container type label for easy access
        const typeValue = c.cr650_container_type;
        if (typeValue != null) {
          c.cr650_container_type_label = CONTAINER_TYPE_LABEL_FROM_OPTIONSET[typeValue] || "";
        }
      }
    });

    return map;
  }


  function rebuildAssignmentTableWithSync() {
    // Call the original rebuild
    rebuildAssignmentTable();

    // ✅ After rebuilding assignment table, sync back to order items if needed
    syncAssignmentToOrderItems();
  }


  /**
     * ✅ NEW: Sync assignment table changes back to order items table
     */
  function syncAssignmentToOrderItems() {
    const lpIndex = buildLpRowIndex();

    DCL_CONTAINER_ITEMS_STATE.forEach(ci => {
      const lpIdLower = (ci.lpId || "").toLowerCase();
      const lpRow = lpIndex.get(lpIdLower);

      if (!lpRow) return;

      // Find corresponding order item row by container item ID
      const orderItemRow = Q(`#itemsTableBody tr[data-container-item-id="${ci.id}"]`);
      if (!orderItemRow) return;

      // Update quantity if changed
      const qtyInput = orderItemRow.querySelector(".loading-qty");
      if (qtyInput && asNum(qtyInput.value) !== ci.quantity) {
        qtyInput.value = ci.quantity;

        // Trigger recalculation
        recalcRow(orderItemRow);
      }

      // Update container assignment if changed
      //const containerSelect = orderItemRow.querySelector(".container-no");

    });

    recomputeTotals();
  }

  /**
   * ✅ NEW: Refresh order items display after assignment changes
   */
  async function refreshOrderItemsDisplay() {
    if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) return;

    try {
      // Fetch fresh LP rows
      const lpRows = await fetchExistingLoadingPlansForCurrentDcl(CURRENT_DCL_ID);

      // Clear current display
      const tbody = Q("#itemsTableBody");
      if (tbody) {
        tbody.innerHTML = "";
      }

      // Re-import with updated split logic
      await importExistingDclLpRows(lpRows);

      console.log("✅ Order items display refreshed to reflect assignment changes");
    } catch (err) {
      console.error("Failed to refresh order items display", err);
    }
  }


  // ✅ Export the modified functions
  window.importExistingDclLpRows = importExistingDclLpRows;
  window.refreshOrderItemsDisplay = refreshOrderItemsDisplay;

  /* =============================
     11) CONTAINERS
     ============================= */
  function extractPackInfo(desc) {
    if (!desc) return null;

    const s = String(desc).replace(/\s+/g, " ").trim();

    // Try pattern: "6 x 4 Lit" or "6 X 4 L"
    const m1 = s.match(/(\d+)\s*[xX×]\s*([\d\.]+)\s*[Ll]/i);
    if (m1) {
      return {
        units: Number(m1[1]),
        size: Number(m1[2])
      };
    }

    // Try pattern: "208 Liter" (drums)
    const m2 = s.match(/(\d+)\s*[Ll]it/i);
    if (m2) {
      return {
        units: 1,
        size: Number(m2[1])
      };
    }

    // ✅ ADD THIS NEW SECTION:
    // Handle standalone numbers (e.g., "208" for drums)
    const m3 = s.match(/^(\d+)$/);
    if (m3) {
      const num = Number(m3[1]);
      // If it's a drum size (200-210 range), treat as drums
      if (num >= 200 && num <= 210) {
        return {
          units: 1,
          size: num  // Normalize to 208L
        };
      }
    }

    // No match
    return null;
  }



  function matchFgForOutstanding(outRow) {
    let outDesc = outRow.cr650_product_name || "";
    const outPack = outRow.cr650_pack_desc || "";

    // Clean description
    outDesc = outDesc.replace(/^\d+,\s*/, '').trim();
    outDesc = outDesc.replace(/:\s*L(TR)?$/i, '').trim();
    outDesc = outDesc.replace(/^[\d\s-]+/, '').trim();
    outDesc = outDesc.replace(/,?\s*L(TR|ITER)?$/i, '').trim();
    outDesc = outDesc.replace(/CH-4/gi, 'CH4');
    outDesc = outDesc.replace(/SJ|SN|SL|SP|CF-4|CF4|CI-4|CI4/gi, '').trim();

    const outPackInfo = extractPackInfo(outPack);

    console.log("🔍 Matching:", {
      desc: outDesc.substring(0, 50),
      pack: outPack,
      packInfo: outPackInfo
    });

    let best = null;
    let bestScore = 0;

    for (const fg of FG_MASTER) {
      const fgName = fg.cr650_fg_name || "";
      const fgPackDetails = fg.cr650_packingdetails || "";
      const fgPackInfo = extractPackInfo(fgPackDetails);

      if (!fgName) continue;

      let score = 0;
      let hasPackMatch = false;
      let descSim = 0;

      // STRATEGY 1: Packing match (40% weight)
      if (outPackInfo && fgPackInfo) {
        if (outPackInfo.units === fgPackInfo.units &&
          outPackInfo.size === fgPackInfo.size) {
          score += 0.4;
          hasPackMatch = true;
        } else if (outPackInfo.size === fgPackInfo.size) {
          score += 0.2;
        }
      }

      // STRATEGY 2: Description similarity (50% weight)
      descSim = descSimilarity(outDesc, fgName);
      score += descSim * 0.5;

      // STRATEGY 3: Brand match (10% weight)
      const brand = String(fg.cr650_brand || "").toLowerCase();
      if (brand && outDesc.toLowerCase().includes(brand)) {
        score += 0.1;
      }

      // ✅ FIXED: Require 55% description match when pack matches
      if (hasPackMatch && descSim < 0.55) {
        console.log(`   ⚠️ Rejecting: ${fgName.substring(0, 40)} (desc too different: ${(descSim * 100).toFixed(0)}%)`);
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        best = fg;
      }
    }

    // ✅ FIXED: Higher thresholds (0.7 with pack, 0.45 without)
    const threshold = outPackInfo ? 0.7 : 0.45;

    if (best && bestScore >= threshold) {
      console.log(`✅ MATCH (score: ${bestScore.toFixed(2)}):`, {
        fg: best.cr650_fg_name.substring(0, 50),
        pack: best.cr650_packingdetails,
        weight: best.cr650_grossweightpercartonkg + " kg",
        dims: `${best.cr650_lengthmm}×${best.cr650_widthmm}×${best.cr650_heightmm} mm`
      });
      return best;
    }

    console.log(`❌ NO MATCH (best score: ${bestScore.toFixed(2)}, threshold: ${threshold})`);

    if (best && bestScore > 0.2) {
      console.log(`   Best candidate: ${best.cr650_fg_name.substring(0, 50)} (not good enough)`);
    }

    return null;
  }
  w.matchFgForOutstanding = matchFgForOutstanding;

  /**
   * Debug helper: Log FG Master matching results
   */
  function logFgMatchingDebug(enabled = true) {
    if (!enabled) return;

    console.group("🔍 FG Master Matching Debug");
    console.log("Total FG Master records:", window.FG_MASTER?.length || 0);

    const lpRows = QA("#itemsTableBody tr.lp-data-row");
    const matches = [];
    const noMatches = [];

    lpRows.forEach((lpRow, idx) => {
      const description = lpRow.querySelector(".description")?.textContent || "";
      const packaging = lpRow.querySelector(".packaging")?.textContent || "";

      const pseudoOut = {
        cr650_product_name: description,
        cr650_pack_desc: packaging
      };

      const fg = matchFgForOutstanding(pseudoOut);

      if (fg) {
        matches.push({
          row: idx + 1,
          description: description.substring(0, 40),
          matched: fg.cr650_fg_name?.substring(0, 40),
          dimensions: `${fg.cr650_lengthmm}×${fg.cr650_widthmm}×${fg.cr650_heightmm}`,
          weight: fg.cr650_grossweightpercartonkg
        });
      } else {
        noMatches.push({
          row: idx + 1,
          description: description.substring(0, 40),
          packaging: packaging
        });
      }
    });

    console.log(`✓ Matched: ${matches.length}`);
    console.table(matches);

    console.log(`❌ Not Matched: ${noMatches.length}`);
    console.table(noMatches);

    console.groupEnd();
  }

  // Expose to window for manual testing
  window.logFgMatchingDebug = logFgMatchingDebug;


  function matchFgForLpRow(lpRow) {
    if (!lpRow) return null;

    const itemCode = (lpRow.querySelector(".item-code")?.textContent || "").trim();
    const packaging = (lpRow.querySelector(".packaging")?.textContent || "").trim();
    const description = (lpRow.querySelector(".description")?.textContent || "").trim();

    if (!itemCode && !packaging && !description) return null;

    // Build pseudo Outstanding object from LP row DOM elements
    const pseudoOut = {
      cr650_product_name: description,
      cr650_pack_desc: packaging,
      cr650_product_no: itemCode
    };

    return matchFgForOutstanding(pseudoOut);
  }

  // Also expose it to window for testing
  w.matchFgForLpRow = matchFgForLpRow;



  /**
   * ✅ CORRECT: Logistics-grade split algorithm
   * Based on weight/volume constraints, deterministic, auditable
   */
  function splitIntoContainers({
    totalQty,
    numContainers,
    perUnitWeightKg,
    perUnitVolumeM3 = null,
    containerMaxWeightKg,
    containerMaxVolumeM3 = null
  }) {
    if (totalQty <= 0 || numContainers < 1) {
      throw new Error("Invalid input");
    }

    // STEP 1: Calculate max qty per container
    const maxByWeight = Math.floor(containerMaxWeightKg / perUnitWeightKg);

    const maxByVolume = perUnitVolumeM3 && containerMaxVolumeM3
      ? Math.floor(containerMaxVolumeM3 / perUnitVolumeM3)
      : Infinity;

    const maxQtyPerContainer = Math.min(maxByWeight, maxByVolume);

    if (maxQtyPerContainer <= 0) {
      throw new Error("Item too heavy/large for container type");
    }

    // STEP 2: Feasibility check
    const minRequiredContainers = Math.ceil(totalQty / maxQtyPerContainer);

    if (minRequiredContainers > numContainers) {
      return {
        feasible: false,
        minRequiredContainers,
        maxQtyPerContainer,
        message: `This quantity requires at least ${minRequiredContainers} containers (max ${maxQtyPerContainer} units per container). You selected ${numContainers}.`
      };
    }

    // STEP 3: Balanced distribution
    const baseQty = Math.floor(totalQty / numContainers);
    const remainder = totalQty % numContainers;

    const distribution = [];
    for (let i = 0; i < numContainers; i++) {
      distribution.push(
        i === numContainers - 1
          ? baseQty + remainder
          : baseQty
      );
    }

    return {
      feasible: true,
      distribution,
      maxQtyPerContainer,
      utilizationPercentages: distribution.map(qty =>
        ((qty / maxQtyPerContainer) * 100).toFixed(1) + '%'
      )
    };
  }

  /**
   * Get container capacity for an item from LP row data
   */
  function getContainerCapacityForItem(containerType, lpRow) {
    const constraints = CONTAINER_CONSTRAINTS[containerType];
    if (!constraints) {
      throw new Error(`Unknown container type: ${containerType}`);
    }

    const containerMaxWeightKg = constraints.maxWeight || 25000;
    const containerMaxVolumeM3 = constraints.maxVolume || null;

    // Get per-unit weight and volume from LP row
    const totalGross = asNum(lpRow.querySelector(".gross-weight")?.textContent);
    const totalLiters = asNum(lpRow.querySelector(".total-liters")?.textContent);
    const loadingQty = asNum(lpRow.querySelector(".loading-qty")?.value);

    if (loadingQty <= 0) {
      throw new Error("Loading quantity must be greater than 0");
    }

    const perUnitWeightKg = totalGross / loadingQty;
    const perUnitVolumeM3 = totalLiters > 0
      ? (totalLiters / loadingQty) / 1000
      : null;

    return {
      containerMaxWeightKg,
      containerMaxVolumeM3,
      perUnitWeightKg,
      perUnitVolumeM3
    };
  }


  /* =============================
     VALIDATION HELPER
     ============================= */

  function validateContainerItemQuantities(lpId) {
    const lpIndex = buildLpRowIndex();
    const lpRow = lpIndex.get((lpId || "").toLowerCase());

    if (!lpRow) {
      console.warn(`LP row not found: ${lpId}`);
      return false;
    }

    const lpTotal = asNum(lpRow.querySelector(".loading-qty")?.value);

    const containerItems = DCL_CONTAINER_ITEMS_STATE.filter(
      ci => ci.lpId && ci.lpId.toLowerCase() === lpId.toLowerCase()
    );

    const ciTotal = containerItems.reduce((sum, ci) => sum + (ci.quantity || 0), 0);

    if (Math.abs(ciTotal - lpTotal) > 0.01) {
      const difference = ciTotal - lpTotal;

      console.error(`Quantity mismatch for LP ${lpId}:`, {
        lpQuantity: lpTotal,
        containerItemsTotal: ciTotal,
        difference: difference
      });

      // ✅ ADD THIS - Show user-facing warning:
      showValidation("error",
        `Data integrity issue: LP row has ${lpTotal} units but container items total ${ciTotal} units. ` +
        `Difference: ${difference.toFixed(2)} units.`
      );

      return false;
    }

    return true;
  }
  w.validateContainerItemQuantities = validateContainerItemQuantities;



  /* =============================
     MERGE SPLIT ITEMS
     ============================= */

  async function mergeContainerItems(itemIds) {
    if (!itemIds || itemIds.length < 2) {
      showValidation("warning", "Select at least 2 items to merge");
      return;
    }

    // Get all items
    const items = itemIds.map(id =>
      DCL_CONTAINER_ITEMS_STATE.find(ci => ci.id === id)
    ).filter(Boolean);

    if (items.length < 2) {
      showValidation("error", "Could not find all selected items");
      return;
    }

    // Validate same LP row
    const lpIds = new Set(items.map(i => i.lpId?.toLowerCase()));
    if (lpIds.size > 1) {
      showValidation("error", "Cannot merge items from different LP rows");
      return;
    }

    const lpId = items[0].lpId;
    const totalQty = items.reduce((sum, i) => sum + (i.quantity || 0), 0);
    const keepItem = items[0];

    try {
      setLoading(true, "Merging items...");

      // Update first item with total quantity
      await patchContainerItem(keepItem.id, {
        cr650_quantity: totalQty,
        cr650_issplititem: false
      });

      keepItem.quantity = totalQty;
      keepItem.isSplitItem = false;

      // Delete other items
      for (let i = 1; i < items.length; i++) {
        await safeAjax({
          type: "DELETE",
          url: `${DCL_CONTAINER_ITEMS_API}(${items[i].id})`,
          headers: {
            Accept: "application/json;odata.metadata=minimal",
            "If-Match": "*"
          },
          dataType: "json"
        });

        const idx = DCL_CONTAINER_ITEMS_STATE.findIndex(ci => ci.id === items[i].id);
        if (idx >= 0) {
          DCL_CONTAINER_ITEMS_STATE.splice(idx, 1);
        }
      }

      // Refresh UI
      await ensureContainerItemsForCurrentDcl();
      rebuildAssignmentTable();
      renderContainerCards();
      renderContainerSummaries();
      refreshAIAnalysis();


      if (!validateContainerItemQuantities(lpId)) {
        showValidation("warning", "Merge completed but quantities may not match. Please verify.");
      } else {
        showValidation("success", `Merged ${items.length} items into one (${totalQty} units)`);
      }

    } catch (err) {
      console.error("Failed to merge items", err);
      showValidation("error", "Failed to merge items");
    } finally {
      setLoading(false);
    }
  }
  w.mergeContainerItems = mergeContainerItems;

  function descSimilarity(a, b) {
    if (!a || !b) return 0;

    // Normalize both strings
    const normalize = (str) => {
      return String(str)
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")  // Replace special chars with space
        .replace(/\s+/g, " ")           // Collapse multiple spaces
        .trim()
        .split(" ")
        .filter(w => w.length > 2);     // Ignore very short words
    };

    const wordsA = normalize(a);
    const wordsB = normalize(b);

    if (!wordsA.length || !wordsB.length) return 0;

    const setA = new Set(wordsA);
    const setB = new Set(wordsB);

    // Count exact word matches
    let exactMatches = 0;
    for (const word of setA) {
      if (setB.has(word)) exactMatches++;
    }

    // Count partial matches (substring matching)
    let partialMatches = 0;
    for (const wordA of wordsA) {
      for (const wordB of wordsB) {
        if (wordA.length >= 4 && wordB.length >= 4) {
          if (wordA.includes(wordB) || wordB.includes(wordA)) {
            partialMatches += 0.5; // Partial match worth 0.5
            break;
          }
        }
      }
    }

    const totalMatches = exactMatches + partialMatches;
    const maxWords = Math.max(setA.size, setB.size);

    return totalMatches / maxWords;
  }


  function mapContainerTypeLabel(label) {
    if (!label) return null;
    const v = String(label).toLowerCase();

    if (v.includes("20") && v.includes("ft") && v.includes("flexi")) return "Flexi Bag 20ft";
    if (v.includes("40") && v.includes("ft") && v.includes("flexi")) return "Flexi Bag 40ft";

    if (v.includes("iso")) return "ISO Tank Container";
    if (v.includes("high") && v.includes("cube")) return "40ft High Cube";

    if (v.includes("20") && v.includes("ft")) return "20ft Container";
    if (v.includes("40") && v.includes("ft")) return "40ft Container";

    if (v.includes("bulk")) return "Bulk Tanker";
    if (v.includes("truck")) return "Truck";

    return null;
  }

  function populateContainerTypeDropdown() {
    const select = Q("#containerTypeSelect");
    if (!select) return;

    select.innerHTML = '<option value="">Select container type...</option>';

    Object.entries(CONTAINER_CONSTRAINTS).forEach(([type, cfg]) => {
      const opt = d.createElement("option");
      opt.value = type;

      const cap = cfg.maxWeight != null
        ? cfg.maxWeight.toLocaleString() + " kg"
        : "capacity not specified";

      const vol = cfg.maxVolume != null ? `, ~${cfg.maxVolume} m³` : "";

      opt.textContent = `${type} (${cap}${vol})`;
      select.appendChild(opt);
    });
  }

  function getVolumeConfidenceBadge(sources) {
    if (!sources || !sources.length) return '';

    const exactCount = sources.filter(s => s === "exact").length;
    const total = sources.length;

    if (exactCount === total) {
      return '<span style="color:#28a745;font-size:9px;margin-left:4px;">✓ Exact</span>';
    } else if (exactCount > 0) {
      const percent = Math.round((exactCount / total) * 100);
      return `<span style="color:#ffc107;font-size:9px;margin-left:4px;">⚠ ${percent}% Exact</span>`;
    } else {
      return '<span style="color:#ffc107;font-size:9px;margin-left:4px;">⚠ Estimated</span>';
    }
  }

  function renderContainerCards() {
    const grid = Q("#containerCardsGrid");
    const countSpan = Q("#containerCount");
    if (!grid) return;

    if (countSpan) {
      countSpan.textContent = DCL_CONTAINERS_STATE.length;
    }

    if (!DCL_CONTAINERS_STATE.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-inbox"></i>
          <p>No containers added yet</p>
        </div>
      `;
      return;
    }

    // Build real-time usage data from container items
    const lpIndex = buildLpRowIndex();
    const usageMap = new Map();

    // Calculate actual weight and volume usage for each container
    DCL_CONTAINER_ITEMS_STATE.forEach(ci => {
      if (!ci.containerGuid) return;

      const cont = DCL_CONTAINERS_STATE.find(
        c => c.dataverseId && ci.containerGuid &&
          c.dataverseId.toLowerCase() === ci.containerGuid.toLowerCase()
      );

      if (!cont) return;

      const lpRow = lpIndex.get((ci.lpId || "").toLowerCase());
      if (!lpRow) return;

      // Try to get FG Master match with improved error handling
      let fg = null;
      let fgMatchMethod = "none";

      // First attempt: Parse stored originalItem (for items imported from Outstanding)
      try {
        const originalData = JSON.parse(lpRow.dataset.originalItem || "{}");
        if (originalData.cr650_product_name) {
          fg = matchFgForOutstanding(originalData);
          if (fg) fgMatchMethod = "original-data";
        }
      } catch (e) {
        // JSON parse failed - will try alternative method
      }

      // Second attempt: Build from LP row DOM elements (for items loaded from Dataverse)
      if (!fg) {
        const itemCode = (lpRow.querySelector(".item-code")?.textContent || "").trim();
        const packaging = (lpRow.querySelector(".packaging")?.textContent || "").trim();
        const description = (lpRow.querySelector(".description")?.textContent || "").trim();

        if (description || packaging) {
          const pseudoOut = {
            cr650_product_name: description,
            cr650_pack_desc: packaging,
            cr650_product_no: itemCode
          };

          fg = matchFgForOutstanding(pseudoOut);
          if (fg) fgMatchMethod = "dom-elements";
        }
      }

      let fgMatchStatus = {
        hasMatch: false,
        hasCompleteDimensions: false,
        weight: 0,
        volume: 0
      };

      if (fg) {
        const L = parseFloat(fg.cr650_lengthmm) || 0;
        const W = parseFloat(fg.cr650_widthmm) || 0;
        const H = parseFloat(fg.cr650_heightmm) || 0;
        const cartonWeight = parseFloat(fg.cr650_grossweightpercartonkg) || 0;

        fgMatchStatus.hasMatch = true;
        fgMatchStatus.hasCompleteDimensions = !!(L > 0 && W > 0 && H > 0);

        // ===== WEIGHT CALCULATION =====
        // ALWAYS use Loading Plan data (authoritative source for weight)
        const totalGross = asNum(lpRow.querySelector(".gross-weight")?.textContent);
        const loadingQty = asNum(lpRow.querySelector(".loading-qty")?.value);

        if (loadingQty > 0 && totalGross > 0) {
          fgMatchStatus.weight = (totalGross / loadingQty) * ci.quantity;
        } else {
          // Fallback if LP data is missing
          fgMatchStatus.weight = ci.quantity;
        }

        // ===== VOLUME CALCULATION =====
        if (fgMatchStatus.hasCompleteDimensions) {
          // ✅ EXACT: Use FG Master dimensions
          const cartonVolM3 = (L * W * H) / 1_000_000_000;
          fgMatchStatus.volume = cartonVolM3 * ci.quantity;
          fgMatchStatus.volumeSource = "exact";

          console.log(`✓ FG Match with exact dimensions:`, {
            item: fg.cr650_fg_name?.substring(0, 40),
            dims: `${L}×${W}×${H}`,
            qty: ci.quantity,
            cartonVol: cartonVolM3.toFixed(6),
            totalVol: fgMatchStatus.volume.toFixed(4),
            weight: fgMatchStatus.weight.toFixed(2)
          });
        } else {
          // ⚠️ ESTIMATED: FG exists but no dimensions - use product liters
          const totalLiters = asNum(lpRow.querySelector(".total-liters")?.textContent);
          const loadingQty = asNum(lpRow.querySelector(".loading-qty")?.value);

          if (loadingQty > 0 && totalLiters > 0) {
            const itemLiters = (totalLiters / loadingQty) * ci.quantity;
            const packaging = lpRow.querySelector(".packaging")?.textContent?.toLowerCase() || "";

            // Apply packing efficiency factor
            let packingFactor = 1.3; // Default
            if (packaging.includes("drum") || packaging.includes("208")) {
              packingFactor = 1.15; // Drums pack efficiently
            } else if (packaging.includes("carton") || packaging.includes("x")) {
              packingFactor = 1.4; // Cartons have air gaps
            }

            fgMatchStatus.volume = (itemLiters / 1000) * packingFactor;
            fgMatchStatus.volumeSource = "estimated";

            console.warn(`⚠ FG Master missing dimensions - using estimated volume:`, {
              item: fg.cr650_fg_name?.substring(0, 40),
              liters: itemLiters,
              factor: packingFactor,
              volumeM3: fgMatchStatus.volume.toFixed(4)
            });
          } else {
            fgMatchStatus.volume = 0;
            fgMatchStatus.volumeSource = "unknown";
          }
        }

      } else {
        // ❌ No FG Master - estimate from LP data only
        const totalGross = asNum(lpRow.querySelector(".gross-weight")?.textContent);
        const totalLiters = asNum(lpRow.querySelector(".total-liters")?.textContent);
        const loadingQty = asNum(lpRow.querySelector(".loading-qty")?.value);

        if (loadingQty > 0) {
          // Weight from LP
          fgMatchStatus.weight = (totalGross / loadingQty) * ci.quantity;

          // Volume from product liters
          if (totalLiters > 0) {
            const itemLiters = (totalLiters / loadingQty) * ci.quantity;
            const packaging = lpRow.querySelector(".packaging")?.textContent?.toLowerCase() || "";

            let packingFactor = 1.3;
            if (packaging.includes("drum") || packaging.includes("208")) packingFactor = 1.15;
            else if (packaging.includes("carton") || packaging.includes("x")) packingFactor = 1.4;

            fgMatchStatus.volume = (itemLiters / 1000) * packingFactor;
            fgMatchStatus.volumeSource = "estimated";

            console.warn(`❌ No FG Master match - using estimated volume:`, {
              lpId: ci.lpId,
              description: lpRow.querySelector(".description")?.textContent?.substring(0, 50),
              liters: itemLiters,
              volumeM3: fgMatchStatus.volume.toFixed(4)
            });
          } else {
            fgMatchStatus.volume = 0;
            fgMatchStatus.volumeSource = "unknown";
          }
        } else {
          fgMatchStatus.weight = ci.quantity;
          fgMatchStatus.volume = 0;
          fgMatchStatus.volumeSource = "unknown";
        }

      }

      // Update usage map using the single status object
      const contId = cont.id;

      if (!usageMap.has(contId)) {
        usageMap.set(contId, {
          weight: 0,
          volume: 0,
          itemCount: 0,
          fgMatched: 0,
          fgMissing: 0,
          volumeSources: []
        });
      }

      const usage = usageMap.get(contId);

      // ✅ Weight stays as-is
      usage.weight += fgMatchStatus.weight;

      // ✅ ✅ ✅ FINAL FIX: Volume MUST come from FG / LP logic ONLY
      usage.volume += fgMatchStatus.volume;

      usage.itemCount += 1;

      // ✅ FG tracking remains correct
      usage.volumeSources.push(fgMatchStatus.volumeSource || "unknown");

      if (fgMatchStatus.hasCompleteDimensions) {
        usage.fgMatched += 1;
      } else {
        usage.fgMissing += 1;
      }



    });

    // 🐛 DEBUG: Log final state before rendering
    console.group("📊 Final usageMap state before rendering");
    usageMap.forEach((usage, contId) => {
      console.log(`Container ${contId}:`, {
        itemCount: usage.itemCount,
        fgMatched: usage.fgMatched,
        fgMissing: usage.fgMissing,
        percentage: usage.itemCount > 0 ? Math.round((usage.fgMatched / usage.itemCount) * 100) + "%" : "N/A"
      });
    });
    console.groupEnd();

    grid.innerHTML = DCL_CONTAINERS_STATE.map(c => {
      const isSaved = !!c.dataverseId;
      const statusBadge = isSaved
        ? '<span style="background:#28a745;color:white;padding:2px 6px;border-radius:3px;font-size:11px;margin-left:8px;">✓ Saved</span>'
        : '<span style="background:#ffc107;color:#333;padding:2px 6px;border-radius:3px;font-size:11px;margin-left:8px;">Unsaved</span>';

      // Get real-time usage data
      const usage = usageMap.get(c.id) || {
        weight: 0,
        volume: 0,
        itemCount: 0,
        fgMatched: 0,
        fgMissing: 0
      };

      // Get capacity constraints
      const constraints = CONTAINER_CONSTRAINTS[c.type] || {};
      const maxWeight = c.maxWeight || constraints.maxWeight || 25000;
      const maxVolume = constraints.maxVolume || null;

      const usedWeight = usage.weight;
      const usedVolume = usage.volume;
      const itemCount = usage.itemCount;
      const fgMatchRate = itemCount > 0 ? Math.round((usage.fgMatched / itemCount) * 100) : 0;

      // Calculate utilization percentages
      const weightUtil = maxWeight > 0 ? ((usedWeight / maxWeight) * 100) : 0;
      const volumeUtil = maxVolume > 0 ? ((usedVolume / maxVolume) * 100) : 0;

      // Determine status color based on highest utilization
      let statusColor = "#28a745"; // green
      let statusText = "Available";

      const highestUtil = Math.max(weightUtil, volumeUtil);

      if (highestUtil > 100) {
        statusColor = "#dc3545"; // red
        statusText = "OVER CAPACITY";
      } else if (highestUtil > 90) {
        statusColor = "#ff6b6b"; // light red
        statusText = "Near Full";
      } else if (highestUtil > 70) {
        statusColor = "#ffc107"; // yellow
        statusText = "Filling Up";
      }

      // Determine if weight or volume is exceeded
      const weightExceeded = weightUtil > 100;
      const volumeExceeded = volumeUtil > 100;

      // FG Master match indicator
      let fgMatchBadge = "";
      if (itemCount > 0) {
        if (fgMatchRate === 100) {
          fgMatchBadge = '<span style="background:#28a745;color:white;padding:2px 6px;border-radius:3px;font-size:10px;margin-left:4px;" title="All items matched to FG Master">✓ 100% FG Matched</span>';
        } else if (fgMatchRate > 0) {
          fgMatchBadge = `<span style="background:#ffc107;color:#333;padding:2px 6px;border-radius:3px;font-size:10px;margin-left:4px;" title="${usage.fgMatched} of ${itemCount} items matched to FG Master">⚠ ${fgMatchRate}% FG Matched</span>`;
        } else {
          fgMatchBadge = '<span style="background:#dc3545;color:white;padding:2px 6px;border-radius:3px;font-size:10px;margin-left:4px;" title="No FG Master matches - using estimates">⚠ No FG Match</span>';
        }
      }

      return `
        <div class="mini-container-card" data-container-id="${escapeHtml(c.id)}" style="
          border:2px solid ${statusColor};
          border-radius:8px;
          padding:12px;
          background:white;
          position:relative;
          ${(weightExceeded || volumeExceeded) ? 'background:#fff5f5;' : ''}
        ">
          ${!isSaved
          ? '<div style="position:absolute;top:8px;right:8px;width:8px;height:8px;background:#ffc107;border-radius:50%;"></div>'
          : ""
        }

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="color:#333;font-size:14px;">${escapeHtml(c.id)}</strong>
            ${statusBadge}
          </div>

          <div style="font-size:12px;color:#6c757d;margin-bottom:6px;">
            ${escapeHtml(c.type || "Unknown")}
            <span style="color:${statusColor};font-weight:bold;margin-left:8px;">${statusText}</span>
          </div>

          <!-- FG Master Match Status -->
          ${itemCount > 0 ? `
            <div style="margin-bottom:8px;padding:6px;background:#f8f9fa;border-radius:4px;">
              <div style="font-size:11px;color:#666;">
                Items: <strong>${itemCount}</strong>
                ${fgMatchBadge}
              </div>
          ${usage.fgMissing > 0 ? `
            <div style="margin-top:6px;padding:6px;background:#fff3cd;border-radius:4px;">
              <div style="font-size:11px;color:#856404;">
                <i class="fas fa-exclamation-triangle"></i>
                ${usage.fgMissing} of ${itemCount} item${usage.fgMissing > 1 ? 's' : ''} missing dimensions
              </div>
            </div>
          ` : ''}
            </div>
          ` : `
            <div style="margin-bottom:8px;padding:6px;background:#f8f9fa;border-radius:4px;text-align:center;">
              <div style="font-size:11px;color:#999;">No items assigned</div>
            </div>
          `}

          <!-- Weight Information -->
          <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#666;margin-bottom:2px;">
              Weight: <strong style="${weightExceeded ? 'color:#dc3545;' : ''}">${usedWeight.toFixed(0)} / ${maxWeight.toLocaleString()} kg</strong>
              ${weightExceeded ? '<span style="color:#dc3545;font-weight:bold;"> ⚠ EXCEEDED</span>' : ''}
            </div>
            <div style="height:6px;background:#e9ecef;border-radius:3px;overflow:hidden;">
              <div style="width:${Math.min(100, weightUtil).toFixed(1)}%;background:${weightExceeded ? '#dc3545' : statusColor};height:100%;transition:width 0.3s;"></div>
            </div>
            <div style="font-size:10px;color:#999;margin-top:2px;">
              ${weightUtil.toFixed(1)}% utilized · ${(maxWeight - usedWeight).toFixed(0)} kg remaining
            </div>
          </div>

          <!-- Volume Information (if applicable) -->
          ${maxVolume ? `
            <div style="margin-bottom:8px;">
              <div style="font-size:11px;color:#666;margin-bottom:2px;">
                Volume: <strong style="${volumeExceeded ? 'color:#dc3545;' : ''}">${usedVolume.toFixed(2)} / ${maxVolume} m³</strong>
                ${getVolumeConfidenceBadge(usage.volumeSources)}
                ${volumeExceeded ? '<span style="color:#dc3545;font-weight:bold;"> ⚠ EXCEEDED</span>' : ''}
              </div>
              <div style="height:6px;background:#e9ecef;border-radius:3px;overflow:hidden;">
                <div style="width:${Math.min(100, volumeUtil).toFixed(1)}%;background:${volumeExceeded ? '#dc3545' : statusColor};height:100%;transition:width 0.3s;"></div>
              </div>
              <div style="font-size:10px;color:#999;margin-top:2px;">
                ${volumeUtil.toFixed(1)}% utilized · ${(maxVolume - usedVolume).toFixed(2)} m³ remaining
              </div>
            </div>
          ` : ''}

          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#6c757d;margin-top:8px;padding-top:8px;border-top:1px solid #e9ecef;">
            <span>Total Items: <strong>${itemCount}</strong></span>
            <button type="button"
              class="delete-container-btn"
              data-container-id="${escapeHtml(c.id)}"
              style="background:#dc3545;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;"
              title="Remove container">
              Delete
            </button>
          </div>

          ${(weightExceeded || volumeExceeded) ? `
            <div style="margin-top:8px;padding:6px;background:#fff3cd;border:1px solid #ffeeba;border-radius:4px;">
              <div style="font-size:11px;color:#856404;">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Warning:</strong> Container capacity exceeded!
                ${weightExceeded && volumeExceeded ? 'Both weight and volume limits exceeded.' :
            weightExceeded ? 'Weight limit exceeded.' : 'Volume limit exceeded.'}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join("");

    // Attach delete button event listeners (CSP-compliant - no inline handlers)
    grid.querySelectorAll(".delete-container-btn").forEach(btn => {
      btn.addEventListener("click", function() {
        const containerId = this.dataset.containerId;
        if (containerId) {
          removeContainerCard(containerId);
        }
      });
    });

  }

  window.renderContainerCards = renderContainerCards;


  // Global variable to track current FG dimension request
  let CURRENT_FG_DIMENSION_REQUEST = null;

  /**
   * Show modal to collect FG Master dimensions
   */
  function showFgDimensionsModal(itemInfo, fgMatch = null) {
    const modal = document.getElementById('fgDimensionsModal');
    if (!modal) {
      console.error('FG Dimensions modal not found in HTML');
      return;
    }

    // Store the request context
    CURRENT_FG_DIMENSION_REQUEST = {
      itemInfo: itemInfo,
      fgMatch: fgMatch,
      timestamp: Date.now()
    };

    // Populate item info
    document.getElementById('fgModalDescription').textContent = itemInfo.description || 'N/A';
    document.getElementById('fgModalPackaging').textContent = itemInfo.packaging || 'N/A';

    // Get weights from Loading Plan row
    let grossWeight = 0;
    let netWeight = 0;

    if (itemInfo.lpId) {
      const lpIndex = buildLpRowIndex();
      const lpRow = lpIndex.get((itemInfo.lpId || "").toLowerCase());

      if (lpRow) {
        const totalGross = parseFloat(lpRow.querySelector(".gross-weight")?.textContent || "0");
        const totalNet = parseFloat(lpRow.querySelector(".net-weight")?.textContent || "0");
        const loadingQty = parseFloat(lpRow.querySelector(".loading-qty")?.value || "0");

        if (loadingQty > 0) {
          grossWeight = (totalGross / loadingQty);
          netWeight = (totalNet / loadingQty);
        }

        console.log("📊 Calculated weights from LP:", {
          totalGross,
          totalNet,
          loadingQty,
          perCartonGross: grossWeight.toFixed(2),
          perCartonNet: netWeight.toFixed(2)
        });
      }
    }

    // Get modal elements
    const matchInfo = document.getElementById('fgModalMatchInfo');
    const matchName = document.getElementById('fgModalMatchName');

    // ✅ CORRECT LOGIC: Handle UPDATE vs CREATE cases
    if (fgMatch) {
      // Pre-populate ALL fields if editing existing FG record
      document.getElementById('fgBrand').value = fgMatch.cr650_brand || '';
      document.getElementById('fgLength').value = fgMatch.cr650_lengthmm || '';
      document.getElementById('fgWidth').value = fgMatch.cr650_widthmm || '';
      document.getElementById('fgHeight').value = fgMatch.cr650_heightmm || '';

      const finalGross = fgMatch.cr650_grossweightpercartonkg || grossWeight;
      const finalNet = fgMatch.cr650_netweightpercartonkg || netWeight;
      document.getElementById('fgGrossWeight').value = finalGross.toFixed(4);
      document.getElementById('fgNetWeight').value = finalNet.toFixed(4);

      // Show FG match info
      if (matchInfo && matchName) {
        matchInfo.style.display = 'block';
        matchName.textContent = fgMatch.cr650_fg_name || 'Unknown Product';
      }

    }


    else {
      // CASE 2: No FG match (CREATE NEW)
      // Always use calculated weights from LP
      document.getElementById('fgGrossWeight').value = grossWeight.toFixed(4);
      document.getElementById('fgNetWeight').value = netWeight.toFixed(4);

      // Hide FG match info
      if (matchInfo) {
        matchInfo.style.display = 'none';
      }
    }

    // Don't clear if editing existing record with dimensions
    if (fgMatch) {
      document.getElementById('fgLength').value = fgMatch.cr650_lengthmm || '';
      document.getElementById('fgWidth').value = fgMatch.cr650_widthmm || '';
      document.getElementById('fgHeight').value = fgMatch.cr650_heightmm || '';
    } else {
      // Only clear for new records
      document.getElementById('fgLength').value = '';
      document.getElementById('fgWidth').value = '';
      document.getElementById('fgHeight').value = '';
    }

    // Show modal
    modal.style.display = 'flex';

    // Focus first input
    setTimeout(() => {
      document.getElementById('fgLength').focus();
    }, 100);
  }
  /**
   * Close the FG dimensions modal
   */
  function closeFgDimensionsModal() {
    const modal = document.getElementById('fgDimensionsModal');
    if (modal) modal.style.display = 'none';
    CURRENT_FG_DIMENSION_REQUEST = null;
  }

  /**
   * Skip dimension entry and use estimate
   */
  function skipFgDimensions() {
    console.log('⏭ User skipped FG dimension entry - using estimate');
    closeFgDimensionsModal();

    // The renderContainerCards function will use fallback estimate
    // No action needed - just close modal
  }


  /**
 * Extract pack size in liters from packaging description
 */
  function extractPackSizeFromPackaging(packaging) {
    if (!packaging) return null;

    const s = String(packaging).toLowerCase();

    // Pattern: "4 x 5 liters" → 5
    const m1 = s.match(/x\s*([\d\.]+)\s*l/i);
    if (m1) {
      return parseFloat(m1[1]);
    }

    // Pattern: "208 liter" → 208
    const m2 = s.match(/([\d\.]+)\s*lit/i);
    if (m2) {
      return parseFloat(m2[1]);
    }

    // Pattern: "208" (standalone) → 208
    const m3 = s.match(/^(\d+)$/);
    if (m3) {
      const num = parseFloat(m3[1]);
      if (num >= 200 && num <= 210) {
        return 208; // Normalize drum size
      }
    }

    return null;
  }



  /**
   * Clean product description for FG Master storage
   * Same cleaning logic as matchFgForOutstanding
   */
  function cleanDescriptionForFgMaster(desc) {
    if (!desc) return desc;

    let cleaned = String(desc);

    // Remove item code prefix (e.g., "120009001765, ")
    cleaned = cleaned.replace(/^\d+,\s*/, '').trim();

    // Remove trailing ": LTR" or ": LITER"
    cleaned = cleaned.replace(/:\s*L(TR|ITER)?$/i, '').trim();

    // Remove leading numbers/dashes
    cleaned = cleaned.replace(/^[\d\s-]+/, '').trim();

    // Remove trailing ", LTR" or ", LITER"
    cleaned = cleaned.replace(/,?\s*L(TR|ITER)?$/i, '').trim();

    // Normalize spec codes
    cleaned = cleaned.replace(/CH-4/gi, 'CH4');

    return cleaned;
  }
  /**
   * Save FG dimensions to Dataverse
   */
  async function saveFgDimensions(event) {
    event.preventDefault();

    if (!CURRENT_FG_DIMENSION_REQUEST) {
      console.error('No FG dimension request context found');
      return;
    }

    const { itemInfo, fgMatch } = CURRENT_FG_DIMENSION_REQUEST;

    // Get form values
    const brand = document.getElementById('fgBrand').value;
    const length = parseFloat(document.getElementById('fgLength').value);
    const width = parseFloat(document.getElementById('fgWidth').value);
    const height = parseFloat(document.getElementById('fgHeight').value);
    const grossWeight = parseFloat(document.getElementById('fgGrossWeight').value);
    const netWeight = parseFloat(document.getElementById('fgNetWeight').value);

    // Validate
    if (!brand || !length || !width || !height || !grossWeight) {
      alert('Please fill all required fields');
      return;
    }

    // Calculate
    const volumeM3 = (length * width * height) / 1_000_000_000;
    const cleanedDescription = cleanDescriptionForFgMaster(itemInfo.description);
    const packSize = extractPackSizeFromPackaging(itemInfo.packaging);

    try {
      const hasFgId = fgMatch && fgMatch.cr650_productspecificationid;

      // 1. Save to Dataverse
      if (hasFgId) {
        await updateFgMasterDimensions(
          fgMatch.cr650_productspecificationid,
          cleanedDescription,
          brand,
          length, width, height,
          grossWeight, netWeight, volumeM3,
          packSize
        );

        // ✅ UPDATE local cache immediately
        const localFg = window.FG_MASTER.find(fg => fg.cr650_productspecificationid === fgMatch.cr650_productspecificationid);
        if (localFg) {
          localFg.cr650_lengthmm = length;
          localFg.cr650_widthmm = width;
          localFg.cr650_heightmm = height;
          localFg.cr650_grossweightpercartonkg = grossWeight;
          localFg.cr650_netweightpercartonkg = netWeight;
          localFg.cr650_cartonvolumem3 = volumeM3;
          console.log('✅ Updated local cache for existing record');
        }

      } else {
        await createFgMasterRecord(
          cleanedDescription,
          itemInfo.packaging,
          brand,
          length, width, height,
          grossWeight, netWeight, volumeM3,
          packSize
        );

        // ✅ ADD to local cache immediately (prevent duplicate creation)
        window.FG_MASTER.push({
          cr650_productspecificationid: 'temp_' + Date.now(), // Temporary ID
          cr650_fg_name: itemInfo.description,
          cr650_packingdetails: itemInfo.packaging,
          cr650_brand: brand,
          cr650_lengthmm: length,
          cr650_widthmm: width,
          cr650_heightmm: height,
          cr650_grossweightpercartonkg: grossWeight,
          cr650_netweightpercartonkg: netWeight,
          cr650_cartonvolumem3: volumeM3
        });
        console.log('✅ Added new record to local cache');
      }

      // 2. Close modal
      closeFgDimensionsModal();

      // 3. Update UI immediately with local cache
      renderContainerCards();

      // 4. Show success
      showValidation('success', '✓ Saved! Click button for next item.');

      // 5. Refresh from Dataverse in background (replace temp data with real)
    } catch (e) {
      console.warn('Background refresh failed:', e);
      showValidation('warning', 'Data saved but refresh failed. Please reload page to see latest data.');
    }
  }

  /**
   * Update existing FG Master record with dimensions
   */
  async function updateFgMasterDimensions(fgId, cleanedDescription, brand, length, width, height, grossWeight, netWeight, volumeM3, packSize = null) {
    const payload = {
      cr650_brand: brand,
      cr650_lengthmm: length,
      cr650_widthmm: width,
      cr650_heightmm: height,
      cr650_grossweightpercartonkg: grossWeight,
      cr650_netweightpercartonkg: netWeight,
      cr650_cartonvolumem3: volumeM3
    };

    // ✅ Add pack size if extracted
    if (packSize) {
      payload.cr650_packsizeliters = packSize;
    }

    console.log("🔄 PATCH payload:", payload);

    await safeAjax({
      type: 'PATCH',
      url: `/_api/cr650_productspecifications(${fgId})`,
      data: JSON.stringify(payload),
      contentType: 'application/json; charset=utf-8',
      headers: {
        'Accept': 'application/json;odata.metadata=minimal',
        'If-Match': '*'
      },
      dataType: 'json',
      _withLoader: true,
      _loaderText: 'Updating FG Master...'
    });
  }

  /**
   * Create new FG Master record
   */
  async function createFgMasterRecord(description, packaging, brand, length, width, height, grossWeight, netWeight, volumeM3, packSize = null) {
    console.log("🆕 Creating FG Master record");

    const payload = {
      cr650_fg_name: description,
      cr650_packingdetails: packaging,
      cr650_brand: brand,
      cr650_lengthmm: length,
      cr650_widthmm: width,
      cr650_heightmm: height,
      cr650_grossweightpercartonkg: grossWeight,
      cr650_netweightpercartonkg: netWeight,
      cr650_cartonvolumem3: volumeM3
    };

    if (packSize) {
      payload.cr650_packsizeliters = packSize;
    }

    console.log("📤 POST payload:", payload);

    await safeAjax({
      type: 'POST',
      url: '/_api/cr650_productspecifications',
      data: JSON.stringify(payload),
      contentType: 'application/json; charset=utf-8',
      headers: {
        'Accept': 'application/json;odata.metadata=minimal'
      },
      dataType: 'json',
      _withLoader: true,
      _loaderText: 'Creating FG Master record...'
    });

    return true;
  }

  /**
   * Refresh FG_MASTER cache from Dataverse
   */

  async function refreshFgMasterCache() {
    try {
      console.log('🔄 Fetching fresh FG Master data...');

      const url = `/_api/cr650_productspecifications?$select=cr650_productspecificationid,cr650_fg_name,cr650_packingdetails,cr650_lengthmm,cr650_widthmm,cr650_heightmm,cr650_grossweightpercartonkg,cr650_netweightpercartonkg,cr650_cartonvolumem3,cr650_brand&$top=5000&_t=${Date.now()}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data && data.value) {
        // Keep temp records that aren't in the fresh data yet
        const tempRecords = window.FG_MASTER.filter(fg =>
          String(fg.cr650_productspecificationid || "").startsWith('temp_')
        );

        window.FG_MASTER = [...data.value, ...tempRecords];
        console.log('✅ FG_MASTER refreshed:', window.FG_MASTER.length, 'records (including', tempRecords.length, 'temp)');
      }
    } catch (error) {
      console.error('❌ Failed to refresh FG_MASTER cache:', error);
      throw error;
    }
  }
  // Expose functions to window
  window.showFgDimensionsModal = showFgDimensionsModal;
  window.closeFgDimensionsModal = closeFgDimensionsModal;
  window.skipFgDimensions = skipFgDimensions;
  window.saveFgDimensions = saveFgDimensions;

  async function loadContainersForCurrentDcl(dclGuid) {
    if (!dclGuid || !isGuid(dclGuid)) {
      console.warn("[DCL Containers] Missing or invalid DCL GUID in URL:", dclGuid);
      DCL_CONTAINERS_STATE = [];
      // REMOVE THIS LINE:
      // renderContainerCards();
      renderContainerSummaries();
      return;
    }

    const selectCols = [
      "cr650_dcl_containerid",
      "cr650_id",
      "cr650_container_type",
      "cr650_container_weight",
      "cr650_total_gross_weight_kg",
      "_cr650_dcl_number_value"
    ].join(",");

    const url =
      `${DCL_CONTAINERS_API}?$select=${encodeURIComponent(selectCols)}&$top=5000`;

    try {
      const data = await safeAjax({
        type: "GET",
        url,
        _withLoader: true,
        _loaderText: "Loading containers…"
      });

      const allRows = Array.isArray(data && data.value) ? data.value : [];
      const dclLower = dclGuid.toLowerCase();

      const rows = allRows.filter(r =>
        String(r._cr650_dcl_number_value || "").toLowerCase() === dclLower
      );

      DCL_CONTAINERS_STATE = rows.map(r => {
        const optionValue = r.cr650_container_type;
        const label = CONTAINER_TYPE_LABEL_FROM_OPTIONSET[optionValue] || "Unknown";

        const cfg = CONTAINER_CONSTRAINTS[label];
        const maxFromConstraints = cfg ? cfg.maxWeight : null;

        const maxWeight =
          maxFromConstraints != null
            ? maxFromConstraints
            : (r.cr650_container_weight || 0);

        const currentWeight = r.cr650_total_gross_weight_kg || 0;

        return {
          id: r.cr650_id || r.cr650_dcl_containerid,
          dataverseId: r.cr650_dcl_containerid,
          type: label,
          maxWeight: Number(maxWeight) || 0,
          currentWeight: Number(currentWeight) || 0,
          items: []
        };
      });

      // REMOVE THIS LINE:
      // renderContainerCards();
      renderContainerSummaries();
    } catch (err) {
      console.error("[DCL Containers] Failed to load containers", err);
      DCL_CONTAINERS_STATE = [];
      // REMOVE THIS LINE:
      // renderContainerCards();
      renderContainerSummaries();

      showValidation(
        "error",
        "Failed to load containers."
      );
    }
  }

  async function resolveContainerGuidByCode(dclGuid, localId) {
    if (!dclGuid || !localId) return null;

    const safeCode = String(localId).replace(/'/g, "''");
    const selectCols = "cr650_dcl_containerid,cr650_id,_cr650_dcl_number_value";
    const filter = `_cr650_dcl_number_value eq ${dclGuid} and cr650_id eq '${safeCode}'`;

    const url = `${DCL_CONTAINERS_API}?$select=${encodeURIComponent(selectCols)}` +
      `&$filter=${encodeURIComponent(filter)}&$top=1`;

    const data = await safeAjax({
      type: "GET",
      url,
      _withLoader: true,
      _loaderText: "Resolving container id…"
    });

    const rows = Array.isArray(data && data.value) ? data.value : [];
    if (!rows.length) return null;

    return rows[0].cr650_dcl_containerid || rows[0].id || null;
  }

  async function createContainerOnServer(type, id, maxWeight) {
    if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
      console.warn("[DCL Containers] No CURRENT_DCL_ID. Skipping server create.", { type, id });
      showValidation("warning", "DCL id not found in URL. Container was created only in memory.");
      return null;
    }

    const optionVal = mapContainerTypeToOptionValue(type);

    const payload = {
      cr650_id: id,
      cr650_container_weight: maxWeight || 0,
      cr650_total_gross_weight_kg: 0
    };

    if (optionVal != null) {
      payload.cr650_container_type = optionVal;
    }

    payload["cr650_dcl_number@odata.bind"] = `/cr650_dcl_masters(${CURRENT_DCL_ID})`;

    let res = {};
    try {
      res = await safeAjax({
        type: "POST",
        url: DCL_CONTAINERS_API,
        data: JSON.stringify(payload),
        contentType: "application/json; charset=utf-8",
        headers: {
          Accept: "application/json;odata.metadata=minimal",
          Prefer: "return=representation"
        },
        dataType: "json",
        _withLoader: true,
        _loaderText: "Saving container…"
      });
    } catch (e) {
      console.error("[DCL Containers] POST failed", e);
      throw e;
    }

    let newId = res && (res.cr650_dcl_containerid || res.id);

    if (!newId) {
      newId = await resolveContainerGuidByCode(CURRENT_DCL_ID, id);
    }

    if (!newId) {
      showValidation(
        "warning",
        `Container ${id} was created but the GUID could not be resolved.`
      );
      return null;
    }

    return newId;
  }

  async function deleteContainerOnServer(serverId) {
    if (!serverId) return;

    await safeAjax({
      type: "DELETE",
      url: `${DCL_CONTAINERS_API}(${serverId})`,
      headers: {
        Accept: "application/json;odata.metadata=minimal",
        "If-Match": "*"
      },
      dataType: "json",
      _withLoader: true,
      _loaderText: "Deleting container…"
    });
  }

  async function removeContainerCard(id) {
    const idx = DCL_CONTAINERS_STATE.findIndex(c => c.id === id);
    if (idx === -1) return;

    const cont = DCL_CONTAINERS_STATE[idx];

    if (cont.dataverseId) {
      try {
        await deleteContainerOnServer(cont.dataverseId);
      } catch (e) {
        console.error("[DCL Containers] Failed to delete container from server", e);
        showValidation("error", `Failed to delete container ${id} from Dataverse.`);
      }
    }

    DCL_CONTAINERS_STATE.splice(idx, 1);
    renderContainerCards();
    renderContainerSummaries();
    rebuildAssignmentTable();
    refreshAIAnalysis();
  }
  w.removeContainerCard = removeContainerCard;

  /* =============================
     11B) CONTAINER SUMMARY BASED ON CONTAINER-ITEMS
     ============================= */

  function buildLpRowIndex() {
    const map = new Map();
    QA("#itemsTableBody tr.lp-data-row").forEach(tr => {
      const id = (tr.dataset.serverId || "").toLowerCase();
      if (id) map.set(id, tr);
    });
    return map;
  }

  async function hydrateLpRowServerIds() {
    const rows = QA("#itemsTableBody tr.lp-data-row");
    if (!rows.length) return;

    // Check if any rows are missing server IDs
    const missingIds = rows.filter(tr => !tr.dataset.serverId);
    if (!missingIds.length) return;

    console.log(`Hydrating ${missingIds.length} LP rows with server IDs...`);

    // Fetch all LP rows for this DCL
    const lpRows = await fetchExistingLoadingPlansForCurrentDcl(CURRENT_DCL_ID);

    // Create a lookup by order number + item code
    const lpLookup = new Map();
    lpRows.forEach(lp => {
      const key = `${lp.cr650_ordernumber}|${lp.cr650_itemcode}`;
      lpLookup.set(key, lp.cr650_dcl_loading_planid);
    });

    // Match DOM rows to server IDs
    let matched = 0;
    rows.forEach(tr => {
      if (tr.dataset.serverId) return; // Already has ID

      const orderNo = (tr.querySelector(".order-no")?.textContent || "").trim();
      const itemCode = (tr.querySelector(".item-code")?.textContent || "").trim();
      const key = `${orderNo}|${itemCode}`;

      const serverId = lpLookup.get(key);
      if (serverId) {
        tr.dataset.serverId = serverId;
        matched++;
      }
    });

    console.log(`Hydrated ${matched} LP rows with server IDs`);
  }

  function computeContainerItemGrossWeight(ci, lpIndex) {
    const lpRow = lpIndex.get((ci.lpId || "").toLowerCase());
    if (!lpRow) {
      return ci.quantity || 0;
    }
    const totalLoad = asNum(lpRow.querySelector(".loading-qty")?.value);
    const totalGross = asNum(lpRow.querySelector(".gross-weight")?.textContent);
    if (!totalLoad || !totalGross) {
      return ci.quantity || 0;
    }
    const ratio = ci.quantity / totalLoad;
    return totalGross * ratio;
  }

  function buildContainerSummaryFromContainerItems() {
    const map = new Map();
    if (!DCL_CONTAINER_ITEMS_STATE.length) return [];

    const lpIndex = buildLpRowIndex();

    DCL_CONTAINER_ITEMS_STATE.forEach(ci => {
      if (!ci.containerGuid) return;

      const cont = DCL_CONTAINERS_STATE.find(
        c => c.dataverseId && ci.containerGuid &&
          c.dataverseId.toLowerCase() === ci.containerGuid.toLowerCase()
      );

      const contId = cont ? cont.id : (ci.containerGuid || "");
      const type = cont ? cont.type : "Unknown";
      const capacity = cont
        ? (cont.maxWeight || (CONTAINER_CAPACITY_KG[cont.type] || 25000))
        : 25000;

      const gross = computeContainerItemGrossWeight(ci, lpIndex);

      if (!map.has(contId)) {
        map.set(contId, {
          id: contId,
          type,
          capacityKg: capacity,
          usedKg: 0
        });
      }
      const obj = map.get(contId);
      obj.usedKg += gross;
    });

    return Array.from(map.values());
  }

  function renderContainerItems(perCont) {
    const list = Q("#containerCards");
    if (!list) return;

    if (!perCont || !perCont.length) {
      list.innerHTML = "";
      return;
    }

    const frag = d.createDocumentFragment();
    perCont.forEach((c) => {
      const usedPct = c.capacityKg
        ? Math.min(100, Math.round((c.usedKg / c.capacityKg) * 100))
        : 0;

      const card = d.createElement("div");
      card.className = "container-card";
      card.style.border = "1px solid #ddd";
      card.style.borderRadius = "8px";
      card.style.padding = "12px";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h4 style="margin:0">${escapeHtml(c.id)} (${escapeHtml(c.type)})</h4>
          <span>Used: ${fmt2(c.usedKg)} / ${fmt2(c.capacityKg)} kg (${usedPct}%)</span>
        </div>
      `;
      frag.appendChild(card);
    });

    list.innerHTML = "";
    list.appendChild(frag);
  }

  function renderContainerSummaries(perContOpt) {
    const sumDiv = Q("#containerSummaryList");
    if (!sumDiv) return;

    let perCont = perContOpt;
    if (!perCont) {
      perCont = buildContainerSummaryFromContainerItems();
    }

    if (!perCont.length) {
      sumDiv.innerHTML = "<p style='font-size:13px;color:#666;'>No containers yet.</p>";
      return;
    }

    const frag = d.createDocumentFragment();
    perCont.forEach((c) => {
      const usedPct = c.capacityKg
        ? Math.min(100, Math.round((c.usedKg / c.capacityKg) * 100))
        : 0;

      const el = d.createElement("div");
      el.style.border = "1px solid #ddd";
      el.style.borderRadius = "8px";
      el.style.padding = "12px";
      el.innerHTML = `
        <strong>${escapeHtml(c.id || c.type)}</strong><br>
        Capacity: ${fmt2(c.capacityKg)} kg<br>
        Used: ${fmt2(c.usedKg)} kg<br>
        Utilization: ${usedPct}%
      `;
      frag.appendChild(el);
    });

    sumDiv.innerHTML = "";
    sumDiv.appendChild(frag);
  }

  /* =============================
     11C) STEP 1 ADD CONTAINERS (WITH QUANTITY)
     ============================= */

  function addContainerFromWizard() {
    const typeSel = Q("#containerTypeSelect");
    const maxWeightInput = Q("#containerMaxWeightInput");
    const qtyInput = Q("#containerQtyInput");

    const type = typeSel ? typeSel.value : "";
    if (!type) {
      showValidation("warning", "Please select a container type first.");
      return;
    }

    let qty = asNum(qtyInput && qtyInput.value);
    if (!qty || qty < 1) {
      qty = 1;
    }

    const maxWeight =
      asNum(maxWeightInput && maxWeightInput.value) ||
      (CONTAINER_CAPACITY_KG[type] || 0);

    const base = type.replace(/\s+/g, "-").toUpperCase();

    const existingIds = new Set(DCL_CONTAINERS_STATE.map(c => c.id));
    let counter = 1;

    for (let i = 0; i < qty; i++) {
      let id;
      do {
        id = `${base}-${String(counter).padStart(2, "0")}`;
        counter++;
      } while (existingIds.has(id));
      existingIds.add(id);

      const cont = {
        id,
        dataverseId: null,
        type,
        maxWeight,
        currentWeight: 0,
        items: []
      };

      DCL_CONTAINERS_STATE.push(cont);

      createContainerOnServer(type, id, maxWeight)
        .then((serverId) => {
          if (serverId) {
            cont.dataverseId = serverId;

            // Ensure anything depending on containers is refreshed
            renderContainerCards();
            renderContainerSummaries();

            // Important: refresh assignment table so the new container appears
            rebuildAssignmentTable();
            attachAssignmentEvents();
            refreshAIAnalysis();
          }
        })
        .catch((e) => {
          console.error("[DCL Containers] Failed to save container", e);
          showValidation("error", `Failed to save container ${id} in Dataverse.`);
        });
    }

    renderContainerCards();
    renderContainerSummaries();
  }

  /* =============================
     12) VALIDATION / LOGISTICS
     ============================= */
  function showValidation(level, msg) {
    const host = Q("#validationAlerts") || Q("#aiWarningsContent") || Q("#aiErrorsContent") || Q("#aiSuggestionsContent");
    if (!host) return;

    const div = d.createElement("div");

    const color = level === "error" ? "#f8d7da"
      : level === "warning" ? "#fff3cd"
        : "#d1e7dd";
    const border = level === "error" ? "#f5c2c7"
      : level === "warning" ? "#ffecb5"
        : "#badbcc";

    div.style.background = color;
    div.style.border = `1px solid ${border}`;
    div.style.borderRadius = "6px";
    div.style.padding = "10px";
    div.style.marginBottom = "8px";
    div.textContent = msg;

    host.appendChild(div);
    setTimeout(() => {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 6000);
  }

  function runValidateAll() {
    let issues = 0;
    const rows = QA("#itemsTableBody tr.lp-data-row");

    rows.forEach((r, idx) => {
      const loadQty = asNum(r.querySelector(".loading-qty")?.value);
      const orderQty = asNum(r.querySelector(".order-qty")?.textContent);

      if (loadQty < 0) {
        issues++;
        showValidation("error", `Row ${idx + 1}: Loading Qty cannot be negative.`);
      }
      if (loadQty > orderQty) {
        issues++;
        showValidation("warning", `Row ${idx + 1}: Loading Qty exceeds Order Qty.`);
      }

      const price = asNum(r.querySelector(".unit-price")?.value);
      if (price < 0) {
        issues++;
        showValidation("error", `Row ${idx + 1}: Unit price cannot be negative.`);
      }
    });

    if (!issues) {
      showValidation("success", "All items passed validation.");
    }
  }

  function runLogisticsCheck() {
    const perCont = buildContainerSummaryFromContainerItems();

    const lpIndex = buildLpRowIndex();
    const totalGross = DCL_CONTAINER_ITEMS_STATE.reduce((s, ci) => {
      return s + computeContainerItemGrossWeight(ci, lpIndex);
    }, 0);

    if (!perCont.length) {
      showValidation("warning", "No containers added. Add containers to run logistics checks.");
      return;
    }
    if (!totalGross) {
      showValidation("warning", "No gross weight found. Enter weights or Loading Qty first.");
      return;
    }

    const avg = totalGross / perCont.length;
    perCont.forEach((c) => {
      if (avg > c.capacityKg) {
        showValidation(
          "warning",
          `${c.type} may be overloaded by estimate. Consider 40ft or split loads.`
        );
      }
    });
  }

  /* =============================
     13) AI PANEL (simplified demo)
     ============================= */
  function refreshAIAnalysis(perContOpt) {
    const perCont = perContOpt || buildContainerSummaryFromContainerItems();
    const cap = perCont.reduce((s, c) => s + (c.capacityKg || 0), 0);
    const used = perCont.reduce((s, c) => s + (c.usedKg || 0), 0);
    const util = cap ? Math.round((used / cap) * 100) : 0;

    setText("#spaceUtilization", util + "%");
    setText("#weightDistribution", Math.min(100, util + 7) + "%");
    setText("#costEfficiency", Math.max(0, 100 - Math.abs(70 - util)) + "%");
  }

  /* =============================
     14) IMPORT CONTROLLER
     ============================= */

  async function buildShippedIndexForOrder(orderNo) {
    try {
      const sRows = await fetchShippedBySo(orderNo);
      return buildShippedIndex(sRows || []);
    } catch {
      return new Map();
    }
  }

  async function importAllOrdersForCurrentDcl(dclGuid, itemMaster) {
    if (!dclGuid) {
      alert("Missing DCL id in URL.");
      return;
    }

    setLoading(true, "Loading orders for this DCL…");

    try {
      const orders = await fetchOrderNumbersForCurrentDcl(dclGuid);
      if (!orders.length) {
        alert("No orders attached to this DCL.");
        return;
      }

      // Fetch all order data in parallel for better performance
      const orderDataPromises = orders.map(async (orderStr) => {
        const orderNo = Number(orderStr);
        if (!Number.isFinite(orderNo)) return null;

        try {
          const [raw, shippedIndex] = await Promise.all([
            fetchOrderLines(orderNo),
            buildShippedIndexForOrder(orderNo)
          ]);
          return { orderNo, raw, shippedIndex };
        } catch (err) {
          console.warn(`Failed to fetch data for order ${orderNo}:`, err);
          return null;
        }
      });

      const orderDataResults = await Promise.all(orderDataPromises);

      // Process results sequentially to avoid race conditions in DOM updates
      for (const orderData of orderDataResults) {
        if (!orderData || !orderData.raw || !orderData.raw.length) continue;
        await importUsingYourCalculations(orderData.raw, itemMaster, orderData.shippedIndex);
      }

      if (!QA("#itemsTableBody tr.lp-data-row").length) {
        alert("No importable lines were found for the DCL's orders.");
      }

      await ensureContainerItemsForCurrentDcl();
      rebuildAssignmentTable();
      renderContainerSummaries();
      refreshAIAnalysis();
    } finally {
      setLoading(false);
    }
  }

  async function preloadSavedLoadingPlanRows(dclGuid) {
    if (!dclGuid) return [];
    setLoading(true, "Loading saved rows and shipping history…");
    try {
      const savedRows = await fetchExistingLoadingPlansForCurrentDcl(dclGuid);
      if (savedRows && savedRows.length) {
        await importExistingDclLpRows(savedRows);
      }
      return savedRows || [];
    } finally {
      setLoading(false);
    }
  }

  /* =============================
     17) ASSIGN ITEMS TO CONTAINERS TABLE (STEP 2)
     ============================= */

  function rebuildAssignmentTable() {
    const tbody = Q("#assignmentTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!DCL_CONTAINER_ITEMS_STATE.length) {
      const tr = d.createElement("tr");
      tr.innerHTML = `
      <td colspan="10" style="text-align:center;color:#666;font-size:12px;">
        No items in loading plan yet.
      </td>`;
      tbody.appendChild(tr);
      return;
    }

    const lpIndex = buildLpRowIndex();
    const containers = (DCL_CONTAINERS_STATE || []).filter(c => c.dataverseId);

    // ✅ GROUP BY LP ROW
    const groupedByLP = new Map();
    DCL_CONTAINER_ITEMS_STATE.forEach(ci => {
      const lpIdLower = (ci.lpId || "").toLowerCase();
      if (!lpIdLower) return;
      if (!groupedByLP.has(lpIdLower)) {
        groupedByLP.set(lpIdLower, []);
      }
      groupedByLP.get(lpIdLower).push(ci);
    });

    console.log("📊 Assignment Table Debug:");
    console.log("  - Total LP groups:", groupedByLP.size);

    // ✅ RENDER with professional split styling
    groupedByLP.forEach((items, lpIdLower) => {
      const lpRow = lpIndex.get(lpIdLower);
      if (!lpRow) {
        console.warn("  ⚠️ No LP row found for:", lpIdLower);
        return;
      }

      const hasSplitItems = items.some(ci => ci.isSplitItem === true);
      const totalItems = items.length;

      console.log(`  - LP ${lpIdLower.substring(0, 8)}... has ${items.length} items (hasSplitItems: ${hasSplitItems})`);

      const orderNo = (lpRow.querySelector(".order-no")?.textContent || "").trim();
      const itemCode = (lpRow.querySelector(".item-code")?.textContent || "").trim();
      const desc = (lpRow.querySelector(".description")?.textContent || "").trim();
      const packaging = (lpRow.querySelector(".packaging")?.textContent || "").trim();

      items.forEach((ci, idx) => {
        const totalLoad = asNum(lpRow.querySelector(".loading-qty")?.value);
        const totalGross = asNum(lpRow.querySelector(".gross-weight")?.textContent);
        const totalVol = asNum(lpRow.querySelector(".total-liters")?.textContent);

        const qty = ci.quantity;
        let gross = qty;
        let vol = qty;

        if (totalLoad > 0) {
          const ratio = qty / totalLoad;
          gross = totalGross * ratio;
          vol = totalVol * ratio;
        }

        // Add pallet weight if palletized
        const isPalletized = ci.palletized === "Yes";
        const numberOfPallets = ci.numberOfPallets || 0;
        const palletWeight = isPalletized ? (numberOfPallets * 19.38) : 0;
        gross += palletWeight;

        // Check FG Master dimensions
        let fg = null;
        let hasDimensions = false;

        if (desc || packaging) {
          fg = matchFgForOutstanding({
            cr650_product_name: desc,
            cr650_pack_desc: packaging,
            cr650_product_no: itemCode
          });

          if (fg) {
            const L = parseFloat(fg.cr650_lengthmm) || 0;
            const W = parseFloat(fg.cr650_widthmm) || 0;
            const H = parseFloat(fg.cr650_heightmm) || 0;
            hasDimensions = (L > 0 && W > 0 && H > 0);
          }
        }

        // ✅ CREATE TR ELEMENT
        const tr = d.createElement("tr");
        tr.dataset.ciId = ci.id;
        tr.dataset.lpId = ci.lpId || "";

        const isSplitItem = ci.isSplitItem === true;

        console.log(`    → Item ${idx + 1}/${items.length}: ${itemCode} (${qty} units) - isSplitItem: ${isSplitItem}`);

        // ✅ PROFESSIONAL SPLIT STYLING
        let splitBadge = "";
        let rowPrefix = "";
        let splitIndicator = "";

        // ✅ Only show split styling when there are actually multiple items (2+)
        if (hasSplitItems && totalItems > 1) {
          // Professional badge - just "Split" text
          splitBadge = `<span class="split-badge">Split</span>`;

          if (idx > 0) {
            // Continuation items - arrow prefix
            rowPrefix = '<span class="split-arrow">↳</span>';
          }
        }

        // Get palletized and # pallets from container item state
        const palletized = ci.palletized || "No";
        const numberOfPallets = ci.numberOfPallets || 0;

        // ✅ SET INNER HTML
        tr.innerHTML = `
        <td>${rowPrefix}${escapeHtml(orderNo)}</td>
        <td>
  ${escapeHtml(itemCode)}${splitBadge}
</td>
        <td>${escapeHtml(desc)}</td>
        <td class="ce-num">
          <input type="number" class="ci-quantity form-control" min="0"
                value="${fmt2(qty)}" style="width:100px" />
        </td>
        <td class="palletized-cell">
          <select class="palletized-select form-control" style="width:70px">
            <option value="No" ${palletized === "No" ? "selected" : ""}>No</option>
            <option value="Yes" ${palletized === "Yes" ? "selected" : ""}>Yes</option>
          </select>
        </td>
        <td class="pallets-cell">
          <input type="number" class="pallets-input form-control" min="0" value="${fmt2(numberOfPallets)}" style="width:70px" />
        </td>
        <td class="ce-num">${fmt2(gross)}</td>
        <td class="ce-num">${fmt2(vol)}</td>
        <td>
          <select class="assign-container form-control">
            <option value="">Not assigned</option>
            ${containers.map(c => {
          const guid = c.dataverseId;
          if (!guid) return "";
          const selected =
            ci.containerGuid && guid &&
              ci.containerGuid.toLowerCase() === guid.toLowerCase()
              ? "selected"
              : "";
          return `<option value="${escapeHtml(guid)}" ${selected}>${escapeHtml(c.id || c.type || "Container")}</option>`;
        }).join("")}
          </select>
        </td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-link btn-sm jump-to-lp">View</button>
          <button type="button" class="btn btn-link btn-sm split-item">Split</button>
          ${!hasDimensions ? `
            <button type="button" class="btn btn-sm add-dims-btn"
                    style="background:#1a7f37;color:white;border:none;padding:4px 8px;border-radius:6px;font-size:0.8rem;margin-left:4px;font-weight:500;"
                    data-lp-id="${escapeHtml(ci.lpId || "")}"
                    data-description="${escapeHtml(desc)}"
                    data-packaging="${escapeHtml(packaging)}"
                    data-item-code="${escapeHtml(itemCode)}">
              <i class="fas fa-plus"></i> Add Dims
            </button>
          ` : `
            <span style="color:#1a7f37;font-size:0.85rem;margin-left:8px;font-weight:600;">
              <i class="fas fa-check-circle"></i> Complete
            </span>
          `}
        </td>
      `;

        // ✅ APPLY PROFESSIONAL CSS CLASSES
        if (hasSplitItems) {
          if (idx === 0) {
            tr.classList.add("split-item-first", "split-group-start");
          } else {
            tr.classList.add("split-continuation-row");
          }

          // Last item in group gets end marker
          if (idx === totalItems - 1) {
            tr.classList.add("split-group-end");
          }

          console.log(`    ✅ Applied professional split styling to row ${idx + 1}`);
        }

        tbody.appendChild(tr);

        // Add inline dimension form if needed (same as before)
        if (!hasDimensions) {
          const formTr = d.createElement("tr");
          formTr.className = "inline-dims-form-row";
          formTr.style.display = "none";
          formTr.dataset.lpId = ci.lpId || "";
          formTr.innerHTML = `
          <td colspan="10" style="background:linear-gradient(to right, #f8fdf9 0%, #ffffff 100%);padding:8px 12px;border-left:3px solid #006633;">
            <form class="dims-inline-form" data-lp-id="${escapeHtml(ci.lpId || "")}" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <div style="flex:1;min-width:200px;font-size:0.85rem;color:#6b7280;">
                <strong style="color:#2c3e50;">${escapeHtml(desc.substring(0, 50))}${desc.length > 50 ? '...' : ''}</strong>
                <div style="color:#6b7280;font-size:0.75rem;">${escapeHtml(packaging)}</div>
              </div>
              <div style="width:110px;">
                <select class="fg-brand-input form-control" required style="font-size:0.85rem;padding:6px 8px;border:2px solid #e0e0e0;border-radius:6px;background:white;">
                  <option value="">Brand...</option>
                  <option value="PETROMIN">PETROMIN</option>
                  <option value="PETRONAS">PETRONAS</option>
                  <option value="ADNOC">ADNOC</option>
                  <option value="NATIONAL">NATIONAL</option>
                  <option value="VOYAGER">VOYAGER</option>
                  <option value="CROWN">CROWN</option>
                  <option value="DUCKHAMS">DUCKHAMS</option>
                  <option value="SPEEDX">SPEEDX</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="number" class="fg-length-input form-control" required placeholder="L" style="width:65px;font-size:0.85rem;padding:6px 8px;border:2px solid #e0e0e0;border-radius:6px;text-align:center;background:white;">
                <span style="color:#9ca3af;font-size:0.85rem;font-weight:500;">×</span>
                <input type="number" class="fg-width-input form-control" required placeholder="W" style="width:65px;font-size:0.85rem;padding:6px 8px;border:2px solid #e0e0e0;border-radius:6px;text-align:center;background:white;">
                <span style="color:#9ca3af;font-size:0.85rem;font-weight:500;">×</span>
                <input type="number" class="fg-height-input form-control" required placeholder="H" style="width:65px;font-size:0.85rem;padding:6px 8px;border:2px solid #e0e0e0;border-radius:6px;text-align:center;background:white;">
                <span style="color:#6b7280;font-size:0.75rem;font-weight:500;">mm</span>
              </div>
              <div style="display:flex;gap:6px;margin-left:auto;">
                <button type="button" class="skip-dims-btn" style="padding:6px 12px;font-size:0.8rem;background:#6b7280;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;">Skip</button>
                <button type="submit" class="save-dims-btn" style="padding:6px 14px;font-size:0.8rem;background:#1a7f37;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;"><i class="fas fa-save"></i> Save</button>
                <button type="button" class="close-dims-form" style="padding:4px 10px;font-size:1.2rem;background:none;border:none;color:#9ca3af;cursor:pointer;line-height:1;">×</button>
              </div>
            </form>
          </td>
        `;
          tbody.appendChild(formTr);
        }
      });
    });

    console.log("✅ Assignment table rebuilt");
  }

  function attachAssignmentEvents() {
    const tbody = Q("#assignmentTableBody");
    if (!tbody || tbody._wired) return;
    tbody._wired = true;

    // Change events: container assignment + quantity change
    tbody.addEventListener("change", async (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const ciId = tr.dataset.ciId;
      const lpId = tr.dataset.lpId;

      const ci = DCL_CONTAINER_ITEMS_STATE.find(c => c.id === ciId);
      if (!ci) return;

      if (e.target.classList.contains("assign-container")) {
        const newGuid = (e.target.value || "").trim() || null;

        try {
          // 1️⃣ Update Dataverse
          if (newGuid) {
            await patchContainerItem(ciId, {
              "cr650_dcl_number@odata.bind": `/cr650_dcl_containers(${newGuid})`
            });
          } else {
            await patchContainerItem(ciId, {
              "cr650_dcl_number@odata.bind": null
            });
          }

          // 2️⃣ Update local object (instant UI consistency)
          ci.containerGuid = newGuid;

          // 3️⃣ FORCE refresh from Dataverse (this is the key fix)
          await refreshContainerItemsState();

          // 4️⃣ Refresh LP DOM (volume depends on this)
          await refreshOrderItemsDisplay();
          recalcAllRows();
          recomputeTotals();

          // 5️⃣ Now render (cards finally see correct volume)
          rebuildAssignmentTable();
          renderContainerCards();
          renderContainerSummaries();
          refreshAIAnalysis();

        } catch (err) {
          console.error("Failed to update container assignment", err);
          showValidation("error", "Failed to update container assignment.");
        }
      }

      // Handle palletized select change (UI-only for now - fields need to be added to Dataverse)
      if (e.target.classList.contains("palletized-select")) {
        // Update local state only
        ci.palletized = e.target.value;

        // Recalculate and refresh UI
        rebuildAssignmentTable();
        renderContainerSummaries();
        recomputeTotals();
      }

      // Handle pallets input change (UI-only for now - fields need to be added to Dataverse)
      if (e.target.classList.contains("pallets-input")) {
        const numberOfPallets = asNum(e.target.value) || 0;

        // Update local state only
        ci.numberOfPallets = numberOfPallets;

        // Recalculate and refresh UI
        rebuildAssignmentTable();
        renderContainerSummaries();
        recomputeTotals();
      }

    });

    // Click events: jump-to-lp + split
    tbody.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const ciId = tr.dataset.ciId;
      const lpId = tr.dataset.lpId;

      if (e.target.classList.contains("jump-to-lp")) {
        const lpIndex = buildLpRowIndex();
        const lpRow = lpIndex.get((lpId || "").toLowerCase());
        if (!lpRow) return;

        lpRow.scrollIntoView({ behavior: "smooth", block: "center" });
        lpRow.classList.add("lp-row-highlight");
        setTimeout(() => lpRow.classList.remove("lp-row-highlight"), 1500);

      } else if (e.target.classList.contains("split-item")) {
        const ci = DCL_CONTAINER_ITEMS_STATE.find(c => c.id === ciId);
        if (!ci) return;
        const originalQty = ci.quantity || 0;

        // ✅ CHECK: Don't allow splitting already-split items
        if (ci.isSplitItem) {
          showValidation("info", "This item is already part of a split group and cannot be split further");
          return;
        }

        // Validate minimum quantity
        if (originalQty <= 1) {
          showValidation("warning", "Cannot split: Quantity must be greater than 1");
          return;
        }

        const maxQty = originalQty - 1;
        const lpIndex = buildLpRowIndex();
        const lpRow = lpIndex.get((ci.lpId || "").toLowerCase());
        if (!lpRow) {
          showValidation("error", "Could not find LP row");
          return;
        }

        const result = await showSimpleSplitPrompt(originalQty, maxQty, lpRow);

        if (result === null) return; // User cancelled

        // ===== HANDLE SIMPLE 2-WAY SPLIT =====
        if (result.mode === 'simple') {
          const splitQty = parseFloat(result.value);

          // Validation
          if (isNaN(splitQty) || splitQty <= 0) {
            showValidation("error", "Invalid input: Enter a number greater than 0");
            return;
          }

          if (!Number.isInteger(splitQty)) {
            showValidation("error", "Invalid input: Please enter a whole number");
            return;
          }

          if (splitQty >= originalQty) {
            showValidation("error", `Invalid input: Must be less than ${originalQty}`);
            return;
          }

          const remainingQty = originalQty - splitQty;

          const confirmed = confirm(
            `Confirm Split\n\n` +
            `New Loading Plan Record: ${splitQty} units\n` +
            `Original Record (Updated): ${remainingQty} units\n\n` +
            `This will:\n` +
            `• Update original LP record to ${remainingQty} units\n` +
            `• Create NEW LP record with ${splitQty} units\n` +
            `• Create container items for both\n\n` +
            `Continue?`
          );

          if (!confirmed) return;

          try {
            setLoading(true, "Creating split records...");

            const lpIndex = buildLpRowIndex();
            const originalLpRow = lpIndex.get((ci.lpId || "").toLowerCase());

            if (!originalLpRow) {
              showValidation("error", "Could not find original LP row");
              return;
            }

            console.log("🔀 Starting 2-way split...");
            console.log("   Split into:", splitQty, "+", remainingQty);

            // Capture original pallet info before split for proportional division
            const originalPalletized = ci.palletized || "No";
            const originalPallets = ci.numberOfPallets || 0;
            const palletDistribution = distributePallets(originalPallets, [remainingQty, splitQty]);
            console.log("   Pallet distribution:", originalPallets, "→", palletDistribution);

            // Update original LP
            const originalLoadingQtyInput = originalLpRow.querySelector(".loading-qty");
            if (originalLoadingQtyInput) {
              originalLoadingQtyInput.value = remainingQty;
            }

            recalcRow(originalLpRow);
            await updateServerRowFromTr(originalLpRow, CURRENT_DCL_ID);

            // Update original container item
            await patchContainerItem(ci.id, {
              cr650_quantity: remainingQty,
              cr650_issplititem: true
            });
            ci.quantity = remainingQty;
            ci.isSplitItem = true;

            // Create new LP record
            const newLpRow = originalLpRow.cloneNode(true);
            delete newLpRow.dataset.serverId;
            delete newLpRow.dataset.containerItemId;

            const newLoadingQtyInput = newLpRow.querySelector(".loading-qty");
            if (newLoadingQtyInput) {
              newLoadingQtyInput.value = splitQty;
            }

            recalcRow(newLpRow);
            originalLpRow.parentNode.insertBefore(newLpRow, originalLpRow.nextSibling);
            await createServerRowFromTr(newLpRow, CURRENT_DCL_ID);

            // Get new LP ID with retry
            let newLpId = newLpRow.dataset.serverId;
            let retryCount = 0;

            while (!newLpId && retryCount < 5) {
              await new Promise(resolve => setTimeout(resolve, 800));

              const orderNo = (newLpRow.querySelector(".order-no")?.textContent || "").trim();
              const itemCode = (newLpRow.querySelector(".item-code")?.textContent || "").trim();

              const fetchUrl =
                `${DCL_LP_API}?$filter=` +
                `_cr650_dcl_number_value eq ${CURRENT_DCL_ID} and ` +
                `cr650_ordernumber eq '${orderNo.replace(/'/g, "''")}' and ` +
                `cr650_itemcode eq '${itemCode.replace(/'/g, "''")}' and ` +
                `cr650_loadedquantity eq ${splitQty}` +
                `&$orderby=createdon desc&$top=1&$select=cr650_dcl_loading_planid`;

              const fetchRes = await safeAjax({
                type: "GET",
                url: fetchUrl,
                headers: { Accept: "application/json;odata.metadata=minimal" },
                dataType: "json",
                _withLoader: false
              });

              if (fetchRes?.value?.length > 0) {
                newLpId = fetchRes.value[0].cr650_dcl_loading_planid;
                newLpRow.dataset.serverId = newLpId;
                break;
              }

              retryCount++;
            }

            if (!newLpId) {
              throw new Error("Failed to get new LP record ID. Please refresh the page.");
            }

            // Create new container item
            await new Promise(resolve => setTimeout(resolve, 500));
            await createContainerItemOnServer(newLpId, splitQty, null, true);

            // Refresh state
            await new Promise(resolve => setTimeout(resolve, 800));
            const allContainerItems = await fetchAllContainerItems(CURRENT_DCL_ID);

            DCL_CONTAINER_ITEMS_STATE = allContainerItems
              .filter(item =>
                item._cr650_dcl_master_number_value &&
                item._cr650_dcl_master_number_value.toLowerCase() === CURRENT_DCL_ID.toLowerCase()
              )
              .map(mapContainerItemRowToState);

            // Apply proportional pallet distribution to split items
            const originalCi = DCL_CONTAINER_ITEMS_STATE.find(c => c.id === ci.id);
            if (originalCi) {
              originalCi.palletized = originalPalletized;
              originalCi.numberOfPallets = palletDistribution[0];
            }
            const newCi = DCL_CONTAINER_ITEMS_STATE.find(c =>
              c.lpId && c.lpId.toLowerCase() === newLpId.toLowerCase() && c.id !== ci.id
            );
            if (newCi) {
              newCi.palletized = originalPalletized;
              newCi.numberOfPallets = palletDistribution[1];
            }
            console.log("   ✅ Applied pallet distribution to split items");

            // Refresh UI
            const tbody = Q("#itemsTableBody");
            if (tbody) {
              tbody._wired = false;
              attachRowEvents(tbody);
            }

            rebuildAssignmentTable();
            attachAssignmentEvents();
            renderContainerCards();
            renderContainerSummaries();
            refreshAIAnalysis();
            recalcAllRows();
            recomputeTotals();

            showValidation("success",
              `✅ Split successful!\n\n` +
              `Original record: ${remainingQty} units (${palletDistribution[0]} pallets)\n` +
              `New record: ${splitQty} units (${palletDistribution[1]} pallets)`
            );

          } catch (err) {
            console.error("❌ 2-way split failed:", err);
            showValidation("error", "Failed to split item. Error: " + (err.message || err));
          } finally {
            setLoading(false);
          }
        }

        // ===== CLEAN APPROACH: Split Handler (No Container Creation) =====

        // This should be renamed from 'containers' to 'multiple' to match the new dialog
        else if (result.mode === 'multiple') {
          const distribution = result.distribution;

          const confirmed = confirm(
            `Confirm ${distribution.length}-Record Split\n\n` +
            distribution.map((qty, idx) => `Record ${idx + 1}: ${qty} units`).join('\n') +
            `\n\nTotal: ${distribution.reduce((a, b) => a + b, 0)} units\n\n` +
            `This will create ${distribution.length} separate loading plan records.\n` +
            `You can assign each record to a container afterward.\n\n` +
            `Continue?`
          );

          if (!confirmed) return;

          try {
            setLoading(true, `Creating ${distribution.length} split records...`);

            const lpIndex = buildLpRowIndex();
            const originalLpRow = lpIndex.get((ci.lpId || "").toLowerCase());

            if (!originalLpRow) {
              showValidation("error", "Could not find original LP row");
              return;
            }

            console.log(`🔀 Starting ${distribution.length}-record split...`);

            // Capture original pallet info before split for proportional division
            const originalPalletized = ci.palletized || "No";
            const originalPallets = ci.numberOfPallets || 0;
            const palletDistribution = distributePallets(originalPallets, distribution);
            console.log("   Pallet distribution:", originalPallets, "→", palletDistribution);

            // Track new LP IDs for pallet assignment later
            const newLpIds = [];

            // ===== STEP 1: UPDATE ORIGINAL LP & CONTAINER ITEM =====
            const firstQty = distribution[0];
            const originalLoadingQtyInput = originalLpRow.querySelector('.loading-qty');
            if (originalLoadingQtyInput) {
              originalLoadingQtyInput.value = firstQty;
            }

            recalcRow(originalLpRow);
            await updateServerRowFromTr(originalLpRow, CURRENT_DCL_ID);

            // Update original container item quantity (NO container assignment)
            await patchContainerItem(ci.id, {
              cr650_quantity: firstQty,
              cr650_issplititem: true
            });

            ci.quantity = firstQty;
            ci.isSplitItem = true;
            // Note: ci.containerGuid remains as-is (could be null or existing container)

            console.log(`✅ Updated original record: ${firstQty} units`);

            // ===== STEP 2: CREATE N-1 NEW LP RECORDS =====
            for (let i = 1; i < distribution.length; i++) {
              const qty = distribution[i];

              console.log(`   Creating record ${i + 1}/${distribution.length}: ${qty} units`);

              // Clone and create new LP row
              const newLpRow = originalLpRow.cloneNode(true);
              delete newLpRow.dataset.serverId;
              delete newLpRow.dataset.containerItemId;

              const newLoadingQtyInput = newLpRow.querySelector('.loading-qty');
              if (newLoadingQtyInput) {
                newLoadingQtyInput.value = qty;
              }

              recalcRow(newLpRow);
              originalLpRow.parentNode.insertBefore(newLpRow, originalLpRow.nextSibling);
              await createServerRowFromTr(newLpRow, CURRENT_DCL_ID);

              // Get new LP ID with retry
              let newLpId = newLpRow.dataset.serverId;
              let retryCount = 0;

              while (!newLpId && retryCount < 5) {
                await new Promise(resolve => setTimeout(resolve, 800));

                const orderNo = (newLpRow.querySelector(".order-no")?.textContent || "").trim();
                const itemCode = (newLpRow.querySelector(".item-code")?.textContent || "").trim();

                const fetchUrl =
                  `${DCL_LP_API}?$filter=` +
                  `_cr650_dcl_number_value eq ${CURRENT_DCL_ID} and ` +
                  `cr650_ordernumber eq '${orderNo.replace(/'/g, "''")}' and ` +
                  `cr650_itemcode eq '${itemCode.replace(/'/g, "''")}' and ` +
                  `cr650_loadedquantity eq ${qty}` +
                  `&$orderby=createdon desc&$top=1&$select=cr650_dcl_loading_planid`;

                const fetchRes = await safeAjax({
                  type: "GET",
                  url: fetchUrl,
                  headers: { Accept: "application/json;odata.metadata=minimal" },
                  dataType: "json",
                  _withLoader: false
                });

                if (fetchRes?.value?.length > 0) {
                  newLpId = fetchRes.value[0].cr650_dcl_loading_planid;
                  newLpRow.dataset.serverId = newLpId;
                  break;
                }

                retryCount++;
              }

              if (!newLpId) {
                throw new Error(`Failed to get LP ID for record ${i + 1}`);
              }

              // Create container item WITHOUT container assignment (null)
              await new Promise(resolve => setTimeout(resolve, 500));
              await createContainerItemOnServer(newLpId, qty, null, true);

              // Track new LP ID for pallet assignment
              newLpIds.push(newLpId);

              console.log(`   ✅ Created record ${i + 1}`);
            }

            // ===== STEP 3: REFRESH STATE & UI =====
            await new Promise(resolve => setTimeout(resolve, 800));
            const allContainerItems = await fetchAllContainerItems(CURRENT_DCL_ID);

            DCL_CONTAINER_ITEMS_STATE = allContainerItems
              .filter(item =>
                item._cr650_dcl_master_number_value &&
                item._cr650_dcl_master_number_value.toLowerCase() === CURRENT_DCL_ID.toLowerCase()
              )
              .map(mapContainerItemRowToState);

            // Apply proportional pallet distribution to all split items
            // First item (original) gets palletDistribution[0]
            const originalCi = DCL_CONTAINER_ITEMS_STATE.find(c => c.id === ci.id);
            if (originalCi) {
              originalCi.palletized = originalPalletized;
              originalCi.numberOfPallets = palletDistribution[0];
            }
            // Remaining items get palletDistribution[1], [2], etc.
            for (let i = 0; i < newLpIds.length; i++) {
              const lpIdLower = newLpIds[i].toLowerCase();
              const newCi = DCL_CONTAINER_ITEMS_STATE.find(c =>
                c.lpId && c.lpId.toLowerCase() === lpIdLower && c.id !== ci.id
              );
              if (newCi) {
                newCi.palletized = originalPalletized;
                newCi.numberOfPallets = palletDistribution[i + 1];
              }
            }
            console.log("   ✅ Applied pallet distribution to all split items");

            // Refresh UI
            const tbody = Q("#itemsTableBody");
            if (tbody) {
              tbody._wired = false;
              attachRowEvents(tbody);
            }

            rebuildAssignmentTable();
            attachAssignmentEvents();
            renderContainerCards();
            renderContainerSummaries();
            refreshAIAnalysis();
            recalcAllRows();
            recomputeTotals();

            // ===== STEP 4: SHOW SUCCESS & GUIDANCE =====
            showValidation('success',
              `✅ Split complete!\n\n` +
              `Created ${distribution.length} loading plan records:\n` +
              distribution.map((q, i) => `  Record ${i + 1}: ${q} units (${palletDistribution[i]} pallets)`).join('\n') +
              `\n\n` +
              `💡 Next step: Assign each record to a container in the Assignment Table below.`
            );

            console.log("✅ Multi-record split completed successfully");

          } catch (err) {
            console.error('❌ Split failed:', err);
            showValidation('error', 'Failed to split records: ' + err.message);
          } finally {
            setLoading(false);
          }
        }
      }
      else if (e.target.classList.contains("add-dims-btn")) {
        // Show inline dimension form
        const formRow = tr.nextElementSibling;
        if (formRow && formRow.classList.contains("inline-dims-form-row")) {
          formRow.style.display = "";

          // Auto-select brand if possible
          const desc = e.target.dataset.description || "";
          const brandSelect = formRow.querySelector(".fg-brand-input");

          if (brandSelect) {
            const descLower = desc.toLowerCase();
            if (descLower.includes("petromin")) brandSelect.value = "PETROMIN";
            else if (descLower.includes("petronas")) brandSelect.value = "PETRONAS";
            else if (descLower.includes("adnoc")) brandSelect.value = "ADNOC";
            else if (descLower.includes("voyager")) brandSelect.value = "VOYAGER";
            else if (descLower.includes("national")) brandSelect.value = "NATIONAL";
          }

          // Focus first input
          const firstInput = formRow.querySelector(".fg-length-input");
          if (firstInput) setTimeout(() => firstInput.focus(), 100);
        }

      } else if (e.target.classList.contains("close-dims-form") || e.target.classList.contains("skip-dims-btn")) {
        // Close inline form
        const formRow = e.target.closest(".inline-dims-form-row");
        if (formRow) formRow.style.display = "none";
      }
    });

    // Handle form submissions for inline dimensions
    tbody.addEventListener("submit", async (e) => {
      if (!e.target.classList.contains("dims-inline-form")) return;

      e.preventDefault();
      const form = e.target;
      const formRow = form.closest(".inline-dims-form-row");
      const lpId = form.dataset.lpId;

      // Get form values
      const brand = form.querySelector(".fg-brand-input").value;
      const length = parseFloat(form.querySelector(".fg-length-input").value);
      const width = parseFloat(form.querySelector(".fg-width-input").value);
      const height = parseFloat(form.querySelector(".fg-height-input").value);

      if (!brand || !length || !width || !height) {
        showValidation("error", "Please fill all required fields");
        return;
      }

      // Get LP data for weight calculation
      const lpIndex = buildLpRowIndex();
      const lpRow = lpIndex.get(lpId.toLowerCase());
      if (!lpRow) return;

      const desc = (lpRow.querySelector(".description")?.textContent || "").trim();
      const packaging = (lpRow.querySelector(".packaging")?.textContent || "").trim();
      const itemCode = (lpRow.querySelector(".item-code")?.textContent || "").trim();
      const totalGross = asNum(lpRow.querySelector(".gross-weight")?.textContent);
      const loadingQty = asNum(lpRow.querySelector(".loading-qty")?.value);

      const grossWeight = loadingQty > 0 ? (totalGross / loadingQty) : 0;
      const netWeight = grossWeight * 0.9; // Estimate
      const volumeM3 = (length * width * height) / 1_000_000_000;
      const packSize = extractPackSizeFromPackaging(packaging);

      try {
        // Check if FG Master already exists
        const fg = matchFgForOutstanding({
          cr650_product_name: desc,
          cr650_pack_desc: packaging,
          cr650_product_no: itemCode
        });

        if (fg && fg.cr650_productspecificationid) {
          // Update existing
          await updateFgMasterDimensions(
            fg.cr650_productspecificationid,
            desc,
            brand,
            length, width, height,
            grossWeight, netWeight, volumeM3,
            packSize
          );

          // Update local cache
          fg.cr650_lengthmm = length;
          fg.cr650_widthmm = width;
          fg.cr650_heightmm = height;
          fg.cr650_grossweightpercartonkg = grossWeight;
          fg.cr650_brand = brand;

        } else {
          // Create new
          await createFgMasterRecord(
            desc,
            packaging,
            brand,
            length, width, height,
            grossWeight, netWeight, volumeM3,
            packSize
          );

          // Add to local cache
          window.FG_MASTER.push({
            cr650_productspecificationid: 'temp_' + Date.now(),
            cr650_fg_name: desc,
            cr650_packingdetails: packaging,
            cr650_brand: brand,
            cr650_lengthmm: length,
            cr650_widthmm: width,
            cr650_heightmm: height,
            cr650_grossweightpercartonkg: grossWeight,
            cr650_netweightpercartonkg: netWeight,
            cr650_cartonvolumem3: volumeM3
          });
        }

        // Hide form
        if (formRow) formRow.style.display = "none";

        // Refresh UI
        rebuildAssignmentTable();
        renderContainerCards();
        showValidation("success", "✓ Dimensions saved!");

      } catch (err) {
        console.error("Failed to save dimensions:", err);
        showValidation("error", "Failed to save dimensions");
      }
    });
  }


  // ===== RECOMMENDED: SIMPLIFIED SPLIT (No Container Creation) =====
  function showSimpleSplitPrompt(total, max, lpRow) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'split-overlay';

      overlay.innerHTML = `
        <div class="split-box" style="max-width:500px;">
          <h4>Split Item</h4>
          <div class="subtitle">Divide this quantity into separate line items</div>
          
          <div class="split-current">
            Total quantity: <strong>${total} units</strong>
          </div>
          
          <!-- Tab Selection -->
          <div class="split-tabs" style="display:flex;gap:8px;margin:16px 0;">
            <button class="split-tab active" data-mode="simple" style="flex:1;padding:8px;border:2px solid #006633;background:#006633;color:white;border-radius:6px;cursor:pointer;">
              Split into 2 Items
            </button>
            <button class="split-tab" data-mode="multiple" style="flex:1;padding:8px;border:2px solid #ddd;background:white;color:#333;border-radius:6px;cursor:pointer;">
              Split into N Items
            </button>
          </div>
          
          <!-- Mode 1: Simple 2-way split -->
          <div class="split-mode" id="simpleSplitMode">
            <div class="split-input-group">
              <label>Enter quantity for first line item:</label>
              <input type="number" id="splitQty" value="${Math.floor(total / 2)}" min="1" max="${max}" step="1">
              <div class="split-validation"></div>
            </div>
            
            <div class="split-preview">
              <div class="split-preview-row">
                <span class="split-preview-label">Line Item 1:</span>
                <span class="split-preview-value" id="previewFirst">${Math.floor(total / 2)} units</span>
              </div>
              <div class="split-preview-row">
                <span class="split-preview-label">Line Item 2:</span>
                <span class="split-preview-value" id="previewSecond">${total - Math.floor(total / 2)} units</span>
              </div>
            </div>
          </div>
          
          <!-- Mode 2: Multiple line items split -->
          <div class="split-mode" id="multipleSplitMode" style="display:none;">
            <div class="split-input-group">
              <label>Number of Line Items:</label>
              <input type="number" id="numRecordsInput" min="2" max="50" value="3" 
                    style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
            </div>
            
            <div class="split-info-box" style="background:#f0f8ff;border-left:3px solid #0066cc;padding:12px;margin-top:12px;border-radius:4px;">
              <div style="font-size:0.85rem;color:#004080;">
                <i class="fas fa-info-circle"></i>
                <strong>How it works:</strong> This creates separate line items in your loading plan with evenly distributed quantities. 
                After splitting, assign each line item to a container in the Assignment Table.
              </div>
            </div>
            
            <div id="multipleSplitPreview"></div>
          </div>
          
          <div class="split-btns">
            <button class="cancel">Cancel</button>
            <button class="ok" disabled>Confirm Split</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const tabs = overlay.querySelectorAll('.split-tab');
      const simpleModeDiv = overlay.querySelector('#simpleSplitMode');
      const multipleModeDiv = overlay.querySelector('#multipleSplitMode');
      const okBtn = overlay.querySelector('.ok');

      let currentMode = 'simple';

      // Tab switching
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => {
            t.classList.remove('active');
            t.style.background = 'white';
            t.style.color = '#333';
            t.style.borderColor = '#ddd';
          });
          tab.classList.add('active');
          tab.style.background = '#006633';
          tab.style.color = 'white';
          tab.style.borderColor = '#006633';

          currentMode = tab.dataset.mode;

          if (currentMode === 'simple') {
            simpleModeDiv.style.display = 'block';
            multipleModeDiv.style.display = 'none';
            validateSimpleSplit();
          } else {
            simpleModeDiv.style.display = 'none';
            multipleModeDiv.style.display = 'block';
            updateMultipleSplitPreview();
          }
        });
      });

      // Simple split validation
      const input = overlay.querySelector('#splitQty');
      const validation = overlay.querySelector('.split-validation');
      const preview = overlay.querySelector('.split-preview');
      const previewFirst = overlay.querySelector('#previewFirst');
      const previewSecond = overlay.querySelector('#previewSecond');

      function validateSimpleSplit() {
        const val = parseFloat(input.value);

        validation.textContent = '';
        validation.className = 'split-validation';
        preview.classList.remove('show');
        input.className = '';
        okBtn.disabled = true;

        if (!val || val <= 0) {
          validation.textContent = 'Must be greater than 0';
          validation.className = 'split-validation error';
          input.className = 'error';
          return false;
        }

        if (val >= total) {
          validation.textContent = `Must be less than ${total}`;
          validation.className = 'split-validation error';
          input.className = 'error';
          return false;
        }

        if (!Number.isInteger(val)) {
          validation.textContent = 'Must be a whole number';
          validation.className = 'split-validation error';
          input.className = 'error';
          return false;
        }

        const remaining = total - val;
        previewFirst.textContent = val + ' units';
        previewSecond.textContent = remaining + ' units';
        preview.classList.add('show');
        input.className = 'valid';
        validation.textContent = 'Valid quantity';
        validation.className = 'split-validation success';
        okBtn.disabled = false;
        return true;
      }

      input.addEventListener('input', validateSimpleSplit);

      // Multiple line items split
      const numInput = overlay.querySelector('#numRecordsInput');
      const multiplePreview = overlay.querySelector('#multipleSplitPreview');

      function updateMultipleSplitPreview() {
        const numRecords = parseInt(numInput.value);

        if (!numRecords || numRecords < 2) {
          multiplePreview.innerHTML = '';
          okBtn.disabled = true;
          return;
        }

        // ✅ SAFETY VALIDATION #1: Prevent more line items than total quantity
        if (numRecords > total) {
          multiplePreview.innerHTML = `
            <div style="color:#b91c1c;font-size:0.9rem;padding:8px;">
              Number of line items cannot exceed total quantity (${total})
            </div>
          `;
          okBtn.disabled = true;
          return;
        }

        // Calculate even distribution
        const distribution = splitEvenly(total, numRecords);

        multiplePreview.innerHTML = `
          <div style="background:#d1e7dd;border:2px solid #006633;border-radius:8px;padding:12px;margin-top:12px;">
            <div style="color:#006633;font-weight:600;margin-bottom:8px;">
              ✓ Distribution Preview
            </div>
            <div style="max-height:200px;overflow-y:auto;">
              ${distribution.map((qty, idx) => `
                <div style="display:flex;justify-content:space-between;padding:6px 8px;background:white;border-radius:4px;margin-bottom:4px;">
                  <span>Line Item ${idx + 1}:</span>
                  <span><strong>${qty}</strong> units</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;

        okBtn.disabled = false;
      }

      // Helper: Split evenly
      function splitEvenly(total, n) {
        const base = Math.floor(total / n);
        const remainder = total % n;
        return Array.from({ length: n }, (_, i) =>
          i === n - 1 ? base + remainder : base
        );
      }

      numInput.addEventListener('input', updateMultipleSplitPreview);

      // Confirm button
      okBtn.addEventListener('click', () => {
        if (currentMode === 'simple') {
          const val = input.value;
          document.body.removeChild(overlay);
          resolve({ mode: 'simple', value: val });
        } else {
          const numRecords = parseInt(numInput.value);
          const distribution = splitEvenly(total, numRecords);

          // ✅ SAFETY VALIDATION #2: Final check before persistence
          if (distribution.some(q => q <= 0)) {
            alert("Invalid split: one or more line items would have zero quantity");
            return;
          }

          document.body.removeChild(overlay);
          resolve({ mode: 'multiple', distribution: distribution });
        }
      });

      // Cancel button
      overlay.querySelector('.cancel').addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(null);
      });

      // Click outside to cancel
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          document.body.removeChild(overlay);
          resolve(null);
        }
      });

      // Initialize
      setTimeout(() => {
        if (currentMode === 'simple') {
          input.focus();
          input.select();
          validateSimpleSplit();
        } else {
          updateMultipleSplitPreview();
        }
      }, 100);
    });
  }
  /* =============================
     18) AUTOMATIC ALLOCATION — uses container-items
     ============================= */

  function allocateItemsToContainers() {
    if (!DCL_CONTAINER_ITEMS_STATE.length) {
      showValidation("warning", "No container items to allocate. Import or add items first.");
      return;
    }

    let containers = DCL_CONTAINERS_STATE
      .filter(c => c.dataverseId)
      .map(c => ({
        id: c.id,
        dataverseId: c.dataverseId,
        type: c.type,
        capacityKg: c.maxWeight || (CONTAINER_CAPACITY_KG[c.type] || 25000),
        usedKg: 0,
        items: []
      }));

    if (!containers.length) {
      showValidation("warning", "No containers defined. Add containers before allocating items.");
      return;
    }

    const lpIndex = buildLpRowIndex();

    const items = DCL_CONTAINER_ITEMS_STATE
      .filter(ci => ci.quantity > 0)
      .map(ci => {
        const weight = computeContainerItemGrossWeight(ci, lpIndex);
        return {
          ci,
          grossKg: weight
        };
      });

    if (!items.length) {
      showValidation("warning", "No positive quantities to allocate.");
      return;
    }

    items.forEach(({ ci, grossKg }) => {
      containers.sort((a, b) => {
        const aRem = a.capacityKg - a.usedKg;
        const bRem = b.capacityKg - b.usedKg;
        return (aRem < bRem) ? 1 : -1;
      });

      const tgt = containers[0];
      tgt.items.push(ci);
      tgt.usedKg += grossKg;

      ci.containerGuid = tgt.dataverseId || null;
    });

    Promise.all(
      DCL_CONTAINER_ITEMS_STATE.map(ci => {
        if (!ci.containerGuid) {
          return patchContainerItem(ci.id, {
            "cr650_dcl_number@odata.bind": null
          });
        }
        return patchContainerItem(ci.id, {
          "cr650_dcl_number@odata.bind": `/cr650_dcl_containers(${ci.containerGuid})`
        });
      })
    )
      .then(async () => {
        // 1️⃣ Refresh container-items from Dataverse (SOURCE OF TRUTH)
        await refreshContainerItemsState();

        // 2️⃣ Refresh LP DOM (needed for volume)
        await refreshOrderItemsDisplay();
        recalcAllRows();
        recomputeTotals();

        // 3️⃣ Render everything from fresh state
        rebuildAssignmentTable();
        renderContainerCards();        // ✅ THIS IS THE KEY LINE
        renderContainerSummaries();    // ❌ no params
        refreshAIAnalysis();           // ❌ no params

        const resetBtn = Q("#resetAssignmentsBtn");
        if (resetBtn) resetBtn.style.display = "inline-flex";

        const section = Q("#allocationStatusSection");
        const statusContent = Q("#statusContent");
        if (section && statusContent) {
          section.style.display = "block";
          statusContent.textContent =
            `Allocated ${items.length} container-item lines into ${DCL_CONTAINERS_STATE.length} containers.`;
        }
      })



      .catch(err => {
        console.error("Failed auto-assign containers", err);
        showValidation("error", "Failed to auto-assign items to containers.");
      });
  }

  function resetAllAssignments() {
    const tbody = Q("#assignmentTableBody");
    if (!tbody) return;

    Promise.all(
      DCL_CONTAINER_ITEMS_STATE.map(ci =>
        patchContainerItem(ci.id, { "cr650_dcl_number@odata.bind": null })
      )
    )
      .then(async () => {
        // 1️⃣ Refresh container-items from Dataverse
        await refreshContainerItemsState();

        // 2️⃣ Refresh LP DOM (volume depends on this)
        await refreshOrderItemsDisplay();
        recalcAllRows();
        recomputeTotals();

        // 3️⃣ Render everything from fresh state
        rebuildAssignmentTable();
        renderContainerCards();       // ✅ REQUIRED
        renderContainerSummaries();
        refreshAIAnalysis();

        const resetBtn = Q("#resetAssignmentsBtn");
        if (resetBtn) resetBtn.style.display = "none";
      })

      .catch(err => {
        console.error("Failed resetting assignments", err);
        showValidation("error", "Failed to reset assignments.");
      });
  }

  /* =============================
     19) SAVE CONTAINER ALLOCATIONS STUB
     ============================= */

  async function saveContainerAllocationsToDataverse() {
    showValidation("success", "Save Containers to Dataverse is not implemented yet, but the button works.");
  }
  w.saveContainerAllocationsToDataverse = saveContainerAllocationsToDataverse;

  const Qall = (sel) => Array.from(d.querySelectorAll(sel));

  function getQueryParam(name) {
    return new URL(w.location.href).searchParams.get(name);
  }

  function isGuid(s) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(String(s || "").trim());
  }


  function getCurrentDclGuid() {
    if (CURRENT_DCL_ID && isGuid(CURRENT_DCL_ID)) return CURRENT_DCL_ID;
    const id = getQueryParam("id");
    if (id && isGuid(id)) {
      CURRENT_DCL_ID = id;
      return id;
    }
    return null;
  }

  // Dev helper: validate LP ↔ Container-items consistency
  function debugValidateAssignmentsDeep() {
    const lpIndex = buildLpRowIndex();
    const byLp = new Map();

    // 1) Group container-items by lpId
    DCL_CONTAINER_ITEMS_STATE.forEach(ci => {
      const lpId = (ci.lpId || "").toLowerCase();
      if (!lpId) return;
      if (!byLp.has(lpId)) {
        byLp.set(lpId, { items: [], qty: 0, gross: 0, liters: 0 });
      }
      byLp.get(lpId).items.push(ci);
    });

    let issues = 0;

    byLp.forEach((group, lpId) => {
      const lpRow = lpIndex.get(lpId);
      if (!lpRow) {
        console.warn("❌ No LP row found for lpId:", lpId);
        issues++;
        return;
      }

      const totalLoad = asNum(lpRow.querySelector(".loading-qty")?.value);
      const totalGross = asNum(lpRow.querySelector(".gross-weight")?.textContent);
      const totalLiters = asNum(lpRow.querySelector(".total-liters")?.textContent);

      // Aggregate from container-items
      let qtySum = 0;
      let grossSum = 0;
      let literSum = 0;

      group.items.forEach(ci => {
        const qty = ci.quantity || 0;
        qtySum += qty;

        if (totalLoad > 0) {
          const ratio = qty / totalLoad;
          grossSum += totalGross * ratio;
          literSum += totalLiters * ratio;
        }
      });

      const qDiff = Math.abs(qtySum - totalLoad);
      const gDiff = Math.abs(grossSum - totalGross);
      const lDiff = Math.abs(literSum - totalLiters);

      if (qDiff > 0.01 || gDiff > 0.1 || lDiff > 0.1) {
        issues++;
        console.group(`❌ Mismatch for LP ${lpId}`);
        console.log("LP:", {
          loadingQty: totalLoad,
          gross: totalGross,
          liters: totalLiters
        });
        console.log("From container-items:", {
          qtySum,
          grossSum: grossSum.toFixed(3),
          literSum: literSum.toFixed(3)
        });
        console.groupEnd();
      }
    });

    if (!issues) {
      console.log("✅ All LP ↔ container-items quantities, weights, and liters are consistent.");
    } else {
      console.warn(`⚠ Found ${issues} LP row(s) with mismatches.`);
    }
  }

  // Expose for console
  window.debugValidateAssignmentsDeep = debugValidateAssignmentsDeep;


  /* =============================
     20) BOOTSTRAP / PAGE INIT - COMPREHENSIVE VERSION
     ============================= */

  d.addEventListener("DOMContentLoaded", async () => {
    // Initialize item master cache
    const itemMaster = w.__ITEM_MASTER__ || {};
    ITEM_MASTER_CACHE = itemMaster;

    // Get DCL ID from URL
    const dclId = getQueryParam("id");
    CURRENT_DCL_ID = dclId;

    // Update step navigation links with DCL ID
    if (CURRENT_DCL_ID && isGuid(CURRENT_DCL_ID)) {
      document.querySelectorAll('.step[data-step]').forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.includes('?id=')) {
          link.setAttribute('href', `${href}?id=${CURRENT_DCL_ID}`);
        }
      });
    }

    if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
      console.warn("No valid 'id' in URL. Some features will be unavailable.");
      setText("#dclNumber", "-");
    } else {
      // ✅ Fetch loading date for filtering
      LOADING_DATE = await fetchLoadingDateFromDcl(CURRENT_DCL_ID);
      console.log("📅 Stored loading date for filtering:", LOADING_DATE);

      // ✅ Fetch currency code
      CURRENCY_CODE = await fetchCurrencyFromDcl(CURRENT_DCL_ID);
      console.log("💱 Using currency:", CURRENCY_CODE);
      await fetchDclStatus(CURRENT_DCL_ID);
      console.log("📋 DCL Status loaded:", DCL_STATUS);
      // Load DCL number display
      await loadAndDisplayDclNumber(CURRENT_DCL_ID);

      // Load all data in correct order
      await preloadSavedLoadingPlanRows(CURRENT_DCL_ID);
      await loadContainersForCurrentDcl(CURRENT_DCL_ID);
      await ensureContainerItemsForCurrentDcl();

      await refreshContainerItemsState();

      // Render everything after data is loaded
      renderContainerCards();
      rebuildAssignmentTable();
      attachAssignmentEvents();
      renderContainerSummaries();
      refreshAIAnalysis();
    }

    // Initialize UI components
    populateContainerTypeDropdown();

    const tbody = Q("#itemsTableBody");
    if (tbody) attachRowEvents(tbody);

    // ===== STEP 1: CONTAINER MANAGEMENT =====

    const addContBtn = Q("#addContainerBtn");
    if (addContBtn) {
      addContBtn.addEventListener("click", addContainerFromWizard);
    }

    const clearContainersBtn = Q("#clearContainersBtn");
    if (clearContainersBtn) {
      clearContainersBtn.addEventListener("click", resetAllAssignments);
    }

    // ===== STEP 2: ALLOCATION & ASSIGNMENT (ENHANCED) =====

    /**
     * ✅ ENHANCED: Smart update function that detects and reports all changes
     * - New items added to Loading Plan
     * - Quantity changes in existing items
     * - Items removed from Loading Plan
     * - Shows detailed notification of what changed
     */
    async function updateContainerItemsIncrementally() {
      if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
        showValidation("error", "Missing or invalid DCL id in URL.");
        return;
      }

      try {
        setLoading(true, "Analyzing changes...");

        console.log("=== SMART UPDATE: ANALYZING CHANGES ===");

        // ===== STEP 1: Build current state snapshot =====
        await hydrateLpRowServerIds();
        const lpRows = QA("#itemsTableBody tr.lp-data-row");

        // Map: LP ID → Loading Quantity
        const currentLpState = new Map();
        lpRows.forEach(tr => {
          const lpId = tr.dataset.serverId;
          if (!lpId) return;

          const loadingQty = asNum(tr.querySelector(".loading-qty")?.value);
          const itemCode = tr.querySelector(".item-code")?.textContent || "";
          const orderNo = tr.querySelector(".order-no")?.textContent || "";

          currentLpState.set(lpId.toLowerCase(), {
            lpId,
            loadingQty,
            itemCode,
            orderNo,
            row: tr
          });
        });

        console.log(`1. Current LP rows in Order Items: ${currentLpState.size}`);

        // ===== STEP 2: Build existing CI state snapshot =====
        // Map: LP ID → Container Items
        const existingCiByLp = new Map();
        DCL_CONTAINER_ITEMS_STATE.forEach(ci => {
          const lpId = (ci.lpId || "").toLowerCase();
          if (!lpId) return;

          if (!existingCiByLp.has(lpId)) {
            existingCiByLp.set(lpId, []);
          }
          existingCiByLp.get(lpId).push(ci);
        });

        console.log(`2. Existing Container Items: ${DCL_CONTAINER_ITEMS_STATE.length} (covering ${existingCiByLp.size} LP rows)`);

        // ===== STEP 3: Detect changes =====
        const changes = {
          newItems: [],           // LP rows without any CIs
          quantityChanges: [],    // LP rows where total CI qty ≠ loading qty
          removedItems: [],       // CIs whose LP row no longer exists
          noChanges: []          // LP rows that match perfectly
        };

        // Check for NEW items and QUANTITY changes
        currentLpState.forEach((lpData, lpId) => {
          const cis = existingCiByLp.get(lpId) || [];

          if (cis.length === 0) {
            // NEW ITEM - no container items exist
            if (lpData.loadingQty > 0) {
              changes.newItems.push(lpData);
            }
          } else {
            // EXISTING ITEM - check if quantity changed
            const ciTotalQty = cis.reduce((sum, ci) => sum + (ci.quantity || 0), 0);

            if (Math.abs(ciTotalQty - lpData.loadingQty) > 0.01) {
              changes.quantityChanges.push({
                ...lpData,
                ciTotalQty,
                difference: lpData.loadingQty - ciTotalQty,
                splitCount: cis.length
              });
            } else {
              changes.noChanges.push(lpData);
            }
          }
        });

        // Check for REMOVED items (CIs whose LP row is gone)
        existingCiByLp.forEach((cis, lpId) => {
          if (!currentLpState.has(lpId)) {
            changes.removedItems.push({
              lpId,
              cis,
              ciCount: cis.length,
              totalQty: cis.reduce((sum, ci) => sum + (ci.quantity || 0), 0)
            });
          }
        });

        console.log("3. Change Detection Results:");
        console.log(`   - New items: ${changes.newItems.length}`);
        console.log(`   - Quantity changes: ${changes.quantityChanges.length}`);
        console.log(`   - Removed items: ${changes.removedItems.length}`);
        console.log(`   - Unchanged items: ${changes.noChanges.length}`);

        // ===== STEP 4: Handle changes =====
        let createdCount = 0;
        let updatedCount = 0;
        let deletedCount = 0;

        // A) Create CIs for NEW items
        if (changes.newItems.length > 0) {
          setLoading(true, `Adding ${changes.newItems.length} new item(s)...`);

          for (const item of changes.newItems) {
            try {
              await createContainerItemOnServer(item.lpId, item.loadingQty, null, false);
              createdCount++;
              console.log(`   ✅ Created CI for: ${item.itemCode} (${item.loadingQty} units)`);
            } catch (err) {
              console.error(`   ❌ Failed to create CI for ${item.itemCode}:`, err);
            }
          }
        }

        // B) Handle QUANTITY changes
        if (changes.quantityChanges.length > 0) {
          setLoading(true, `Updating ${changes.quantityChanges.length} quantity change(s)...`);

          for (const item of changes.quantityChanges) {
            const cis = existingCiByLp.get(item.lpId.toLowerCase()) || [];

            // ✅ Strategy: Update the first (non-split) CI with new quantity
            // If item has multiple CIs (splits), user must manually adjust via split interface
            if (cis.length === 1) {
              try {
                await patchContainerItem(cis[0].id, {
                  cr650_quantity: item.loadingQty
                });

                // Update in state
                const ciInState = DCL_CONTAINER_ITEMS_STATE.find(ci => ci.id === cis[0].id);
                if (ciInState) {
                  ciInState.quantity = item.loadingQty;
                }

                updatedCount++;
                console.log(`   ✅ Updated quantity for ${item.itemCode}: ${item.ciTotalQty} → ${item.loadingQty}`);
              } catch (err) {
                console.error(`   ❌ Failed to update quantity for ${item.itemCode}:`, err);
              }
            } else {
              // ⚠️ Split item - don't auto-update, warn user
              console.warn(`   ⚠️ Skipped ${item.itemCode}: Has ${cis.length} splits (manual adjustment required)`);
            }
          }
        }

        // C) Remove orphaned CIs (optional - can be dangerous, so commented out by default)
        // Uncomment if you want to auto-delete CIs when LP row is removed
        /*
        if (changes.removedItems.length > 0) {
          setLoading(true, `Removing ${changes.removedItems.length} deleted item(s)...`);
          
          for (const item of changes.removedItems) {
            for (const ci of item.cis) {
              try {
                await deleteContainerItem(ci.id);
                deletedCount++;
                console.log(`   ✅ Deleted orphaned CI: ${ci.id.substring(0, 8)}...`);
              } catch (err) {
                console.error(`   ❌ Failed to delete CI ${ci.id}:`, err);
              }
            }
          }
        }
        */

        // ===== STEP 5: Refresh container items state =====
        if (createdCount > 0 || updatedCount > 0 || deletedCount > 0) {
          setLoading(true, "Refreshing assignment table...");

          const expectedTotal = DCL_CONTAINER_ITEMS_STATE.length + createdCount - deletedCount;
          let retryCount = 0;
          let success = false;

          while (retryCount < 5 && !success) {
            await new Promise(resolve => setTimeout(resolve, retryCount === 0 ? 1200 : 800));

            try {
              const allContainerItems = await fetchAllContainerItems(CURRENT_DCL_ID);
              const fetchedItems = allContainerItems.filter(item =>
                item._cr650_dcl_master_number_value &&
                item._cr650_dcl_master_number_value.toLowerCase() === CURRENT_DCL_ID.toLowerCase()
              );

              console.log(`   Retry ${retryCount + 1}: Fetched ${fetchedItems.length} items (expected ~${expectedTotal})`);

              if (fetchedItems.length >= expectedTotal - 1) { // Allow 1 item tolerance
                DCL_CONTAINER_ITEMS_STATE = fetchedItems.map(mapContainerItemRowToState);
                success = true;
                console.log(`   ✅ State refreshed with ${DCL_CONTAINER_ITEMS_STATE.length} items`);
                break;
              }
            } catch (fetchErr) {
              console.error(`   ❌ Fetch error on retry ${retryCount + 1}:`, fetchErr);
            }

            retryCount++;
          }

          if (!success) {
            console.warn(`   ⚠️ State refresh incomplete after ${retryCount} retries`);
          }

          // Refresh UI
          rebuildAssignmentTable();
          attachAssignmentEvents();
          renderContainerCards();
          renderContainerSummaries();
          refreshAIAnalysis();
        }

        // ===== STEP 6: Show smart notification =====
        showSmartUpdateNotification(changes, createdCount, updatedCount, deletedCount);

        console.log("=== SMART UPDATE COMPLETE ===");

      } catch (err) {
        console.error("Smart update failed:", err);
        showValidation("error", "Update failed: " + err.message);
      } finally {
        setLoading(false);
      }
    }

    /**
     * ✅ PROFESSIONAL: Toast notification system matching your app theme
     */
    function showNotificationToast({ type = "info", title, message, duration = 4000 }) {
      // Remove any existing toast
      const existingToast = document.querySelector(".update-toast");
      if (existingToast) {
        existingToast.remove();
      }

      // Create toast element
      const toast = document.createElement("div");
      toast.className = `update-toast update-toast-${type}`;

      // Professional color scheme matching your theme
      const themes = {
        success: {
          icon: '<i class="fas fa-check-circle"></i>',
          bg: '#ffffff',
          border: '#28a745',
          iconBg: '#28a745',
          iconColor: '#ffffff',
          titleColor: '#155724',
          textColor: '#495057'
        },
        info: {
          icon: '<i class="fas fa-info-circle"></i>',
          bg: '#ffffff',
          border: '#17a2b8',
          iconBg: '#17a2b8',
          iconColor: '#ffffff',
          titleColor: '#0c5460',
          textColor: '#495057'
        },
        warning: {
          icon: '<i class="fas fa-exclamation-triangle"></i>',
          bg: '#ffffff',
          border: '#ffc107',
          iconBg: '#ffc107',
          iconColor: '#ffffff',
          titleColor: '#856404',
          textColor: '#495057'
        },
        error: {
          icon: '<i class="fas fa-times-circle"></i>',
          bg: '#ffffff',
          border: '#dc3545',
          iconBg: '#dc3545',
          iconColor: '#ffffff',
          titleColor: '#721c24',
          textColor: '#495057'
        }
      };

      const theme = themes[type] || themes.info;

      toast.style.cssText = `
          position: fixed;
          top: 80px;
          right: 20px;
          min-width: 350px;
          max-width: 420px;
          background: ${theme.bg};
          border-left: 4px solid ${theme.border};
          border-radius: 4px;
          padding: 0;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
          z-index: 10000;
          animation: slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          overflow: hidden;
        `;

      toast.innerHTML = `
          <div style="
            display: flex;
            align-items: flex-start;
            padding: 16px;
            gap: 12px;
          ">
            <!-- Icon -->
            <div style="
              flex-shrink: 0;
              width: 40px;
              height: 40px;
              background: ${theme.iconBg};
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: ${theme.iconColor};
              font-size: 18px;
            ">
              ${theme.icon}
            </div>
            
            <!-- Content -->
            <div style="flex: 1; min-width: 0;">
              <div style="
                font-size: 15px;
                font-weight: 600;
                color: ${theme.titleColor};
                margin-bottom: 4px;
                line-height: 1.4;
              ">
                ${title}
              </div>
              <div style="
                font-size: 13px;
                color: ${theme.textColor};
                line-height: 1.5;
                white-space: pre-line;
              ">
                ${message}
              </div>
            </div>
            
            <!-- Close button -->
            <button onclick="this.closest('.update-toast').remove()" style="
              flex-shrink: 0;
              background: transparent;
              border: none;
              color: #6c757d;
              font-size: 20px;
              cursor: pointer;
              padding: 0;
              width: 24px;
              height: 24px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 4px;
              transition: all 0.2s;
            " onmouseover="this.style.background='#f1f3f5'; this.style.color='#212529';" onmouseout="this.style.background='transparent'; this.style.color='#6c757d';">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <!-- Progress bar -->
          <div style="
            height: 3px;
            background: #e9ecef;
            overflow: hidden;
          ">
            <div class="toast-progress" style="
              height: 100%;
              background: ${theme.border};
              width: 100%;
              animation: shrinkProgress ${duration}ms linear;
            "></div>
          </div>
        `;

      // Add CSS animations if not already added
      if (!document.querySelector("#toast-animations")) {
        const style = document.createElement("style");
        style.id = "toast-animations";
        style.textContent = `
            @keyframes slideInRight {
              from {
                transform: translateX(120%);
                opacity: 0;
              }
              to {
                transform: translateX(0);
                opacity: 1;
              }
            }
            
            @keyframes slideOutRight {
              from {
                transform: translateX(0);
                opacity: 1;
              }
              to {
                transform: translateX(120%);
                opacity: 0;
              }
            }
            
            @keyframes shrinkProgress {
              from { width: 100%; }
              to { width: 0%; }
            }
            
            .update-toast:hover .toast-progress {
              animation-play-state: paused !important;
            }
          `;
        document.head.appendChild(style);
      }

      document.body.appendChild(toast);

      // Auto-remove after duration (pause on hover)
      let timeoutId = setTimeout(() => {
        removeToast();
      }, duration);

      // Pause timer on hover
      toast.addEventListener('mouseenter', () => {
        clearTimeout(timeoutId);
      });

      // Resume timer on mouse leave
      toast.addEventListener('mouseleave', () => {
        timeoutId = setTimeout(() => {
          removeToast();
        }, 1000); // Give 1 more second after mouse leaves
      });

      function removeToast() {
        if (toast.parentNode) {
          toast.style.animation = "slideOutRight 0.3s cubic-bezier(0.6, 0, 0.9, 0.2)";
          setTimeout(() => toast.remove(), 300);
        }
      }
    }

    /**
     * ✅ ENHANCED: Show detailed notification with professional formatting
     */
    function showSmartUpdateNotification(changes, createdCount, updatedCount, deletedCount) {
      const totalChanges = createdCount + updatedCount + deletedCount;

      if (totalChanges === 0) {
        // No changes needed
        showNotificationToast({
          type: "info",
          title: "All Items Up to Date",
          message: `${changes.noChanges.length} item${changes.noChanges.length !== 1 ? 's are' : ' is'} already synchronized with the assignment table.`,
          duration: 3500
        });
        return;
      }

      // Build detailed message with clear formatting
      const parts = [];

      if (createdCount > 0) {
        parts.push(`• ${createdCount} new item${createdCount !== 1 ? 's' : ''} added to assignment table`);
      }

      if (updatedCount > 0) {
        parts.push(`• ${updatedCount} item${updatedCount !== 1 ? 's' : ''} updated with new quantities`);
      }

      if (deletedCount > 0) {
        parts.push(`• ${deletedCount} orphaned item${deletedCount !== 1 ? 's' : ''} removed`);
      }

      // Show warnings if any
      const warnings = [];

      const skippedSplits = changes.quantityChanges.filter(c => c.splitCount > 1);
      if (skippedSplits.length > 0) {
        warnings.push(`\n⚠️ ${skippedSplits.length} split item${skippedSplits.length !== 1 ? 's' : ''} skipped - please adjust manually via Split Item feature`);
      }

      if (changes.removedItems.length > 0) {
        warnings.push(`\n⚠️ ${changes.removedItems.length} orphaned container item${changes.removedItems.length !== 1 ? 's were' : ' was'} detected but not deleted automatically`);
      }

      const messageType = warnings.length > 0 ? "warning" : "success";

      showNotificationToast({
        type: messageType,
        title: `Update Complete - ${totalChanges} Change${totalChanges !== 1 ? 's' : ''} Applied`,
        message: parts.join('\n') + warnings.join(''),
        duration: warnings.length > 0 ? 6000 : 4500
      });
    }


    // ✅ UPDATE BUTTON - Enhanced smart update
    const updateAllocationBtn = Q("#updateAllocationBtn");
    if (updateAllocationBtn) {
      updateAllocationBtn.addEventListener("click", updateContainerItemsIncrementally);
    }
    const startAllocationBtn = Q("#startAllocationBtn");
    if (startAllocationBtn) {
      startAllocationBtn.addEventListener("click", async () => {
        if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
          showValidation("error", "Missing or invalid DCL id in URL.");
          return;
        }

        try {
          setLoading(true, "Preparing allocation…");

          console.log("=== START ALLOCATION CLICKED ===");

          // ✅ Hydrate LP rows before anything else
          await hydrateLpRowServerIds();

          console.log("1. Current DCL ID:", CURRENT_DCL_ID);
          console.log("2. Container items before delete:", DCL_CONTAINER_ITEMS_STATE.length);

          await deleteAllContainerItemsForCurrentDcl();
          console.log("3. Container items after delete:", DCL_CONTAINER_ITEMS_STATE.length);

          const freshLpRows = await fetchExistingLoadingPlansForCurrentDcl(CURRENT_DCL_ID);
          console.log("4. Fresh LP rows fetched:", freshLpRows.length);

          await ensureContainerItemsForCurrentDcl(freshLpRows);
          console.log("5. Container items after ensure:", DCL_CONTAINER_ITEMS_STATE.length);

          const domLpRows = QA("#itemsTableBody tr.lp-data-row");
          console.log("6. LP rows in DOM:", domLpRows.length);
          console.log("   DOM LP IDs:", domLpRows.map(tr => tr.dataset.serverId).filter(Boolean));

          const lpIndex = buildLpRowIndex();
          console.log("7. LP Index size:", lpIndex.size);

          // Force UI update
          rebuildAssignmentTable();
          attachAssignmentEvents();
          renderContainerCards();
          renderContainerSummaries();
          refreshAIAnalysis();

          console.log("=== START ALLOCATION COMPLETE ===");

          showValidation(
            "success",
            `Allocation reset: ${DCL_CONTAINER_ITEMS_STATE.length} items loaded in container-items table.`
          );

        } catch (err) {
          console.error("Start Allocation failed", err);
          showValidation("error", "Failed to start allocation. Please try again.");
        } finally {
          setLoading(false);
        }
      });
    }

    const autoAssignBtn = Q("#autoAssignBtn");
    if (autoAssignBtn) {
      autoAssignBtn.addEventListener("click", allocateItemsToContainers);
    }

    const allocateItemsBtn = Q("#allocateItemsBtn");
    if (allocateItemsBtn) {
      allocateItemsBtn.addEventListener("click", allocateItemsToContainers);
    }

    const resetAssignmentsBtn = Q("#resetAssignmentsBtn");
    if (resetAssignmentsBtn) {
      resetAssignmentsBtn.addEventListener("click", resetAllAssignments);
    }

    const optimizeBtn = Q("#optimizeBtn");
    if (optimizeBtn) {
      optimizeBtn.addEventListener("click", runLogisticsCheck);
    }

    // ===== ORDER ITEMS MANAGEMENT =====
    const addItemBtn = Q("#addItemBtn");
    if (addItemBtn) {
      addItemBtn.addEventListener("click", async () => {
        const currRows = QA("#itemsTableBody tr.lp-data-row").length;

        const blank = computeItemData(
          {
            order_no: "",
            product_no: "",
            product_name: "",
            released_flag: "N",
            pack_desc: "EA",
            pack: "EA",
            original_order_qty: 0
          },
          currRows,
          itemMaster,
          null,
          null
        );

        const tr = makeRowEl(blank, currRows);
        tbody.appendChild(tr);
        attachRowEvents(tbody);

        recalcRow(tr);
        recalcAllRows();
        recomputeTotals();
      });
    }

    const importBtn = Q("#importFromOracleBtn");
    if (importBtn) {
      importBtn.addEventListener("click", async () => {
        if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
          alert("Invalid or missing DCL id in URL.");
          return;
        }
        importBtn.disabled = true;
        const oldText = importBtn.textContent;
        importBtn.textContent = "Importing…";
        try {
          await importAllOrdersForCurrentDcl(CURRENT_DCL_ID, itemMaster);
        } catch (e) {
          console.error(e);
          alert("Failed to import order lines for this DCL.");
        } finally {
          importBtn.disabled = false;
          importBtn.textContent = oldText || "Import from Oracle";

          rebuildAssignmentTable();
          attachAssignmentEvents();
          renderContainerCards();
          renderContainerSummaries();
          refreshAIAnalysis();
        }
      });
    }

    // ===== VALIDATION & LOGISTICS =====

    const validateBtn = Q("#validateAllBtn");
    if (validateBtn) {
      validateBtn.addEventListener("click", runValidateAll);
    }

    const logisticsBtn = Q("#logisticsCheckBtn");
    if (logisticsBtn) {
      logisticsBtn.addEventListener("click", runLogisticsCheck);
    }

    // ✅ Auto-save Additional Comments on change
    const commentsField = Q("#additionalComments");
    if (commentsField) {
      let commentsSaveTimeout;
      commentsField.addEventListener("input", () => {
        clearTimeout(commentsSaveTimeout);
        commentsSaveTimeout = setTimeout(() => {
          saveAdditionalDetailsToDataverse().catch(err => {
            console.error("Failed to auto-save comments:", err);
          });
        }, 1000); // Save 1 second after user stops typing
      });
    }

    // ===== AUTO-SAVE LP ADDITIONAL COMMENTS =====
    const lpCommentsField = Q("#lpAdditionalComments");
    const lpCommentsCharCount = Q("#lpCommentsCharCount");
    const lpCommentsSaveIndicator = Q("#lpCommentsSaveIndicator");

    if (lpCommentsField) {
      let lpCommentsSaveTimeout;

      // Update character counter
      function updateLpCommentsCharCount() {
        if (lpCommentsCharCount) {
          lpCommentsCharCount.textContent = lpCommentsField.value.length;
        }
      }

      // Show save indicator
      function showLpCommentsSaved() {
        if (lpCommentsSaveIndicator) {
          lpCommentsSaveIndicator.textContent = '✓ Saved';
          lpCommentsSaveIndicator.style.color = '#10b981';
          lpCommentsSaveIndicator.style.opacity = '1';
          setTimeout(() => {
            lpCommentsSaveIndicator.style.opacity = '0';
          }, 2000);
        }
      }

      // Show save error
      function showLpCommentsSaveError() {
        if (lpCommentsSaveIndicator) {
          lpCommentsSaveIndicator.textContent = '✗ Save failed';
          lpCommentsSaveIndicator.style.color = '#ef4444';
          lpCommentsSaveIndicator.style.opacity = '1';
          setTimeout(() => {
            lpCommentsSaveIndicator.style.opacity = '0';
          }, 3000);
        }
      }

      // Auto-save function
      async function autoSaveLpComments() {
        if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
          console.warn("No valid DCL ID - cannot save LP comments");
          return;
        }

        clearTimeout(lpCommentsSaveTimeout);
        lpCommentsSaveTimeout = setTimeout(async () => {
          try {
            const comments = lpCommentsField.value.trim();

            const payload = {
              cr650_additionalco_lp: comments || null
            };

            await safeAjax({
              type: "PATCH",
              url: `${DCL_MASTER_API}(${CURRENT_DCL_ID})`,
              data: JSON.stringify(payload),
              contentType: "application/json; charset=utf-8",
              headers: {
                Accept: "application/json;odata.metadata=minimal",
                "If-Match": "*"
              },
              dataType: "json",
              _withLoader: false
            });

            console.log("✅ LP comments saved");
            showLpCommentsSaved();

          } catch (err) {
            console.error("❌ Failed to save LP comments:", err);
            showLpCommentsSaveError();
          }
        }, 1000); // Save 1 second after user stops typing
      }

      // Load existing LP comments
      async function loadLpComments() {
        if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
          return;
        }

        try {
          const data = await safeAjax({
            type: "GET",
            url: `${DCL_MASTER_API}(${CURRENT_DCL_ID})?$select=cr650_additionalco_lp`,
            headers: {
              Accept: "application/json;odata.metadata=minimal"
            },
            dataType: "json",
            _withLoader: false
          });

          if (data && data.cr650_additionalco_lp) {
            lpCommentsField.value = data.cr650_additionalco_lp;
            updateLpCommentsCharCount();
            console.log("✅ Loaded existing LP comments");
          }
        } catch (err) {
          console.warn("⚠️ Could not load LP comments:", err);
        }
      }

      // Event listeners
      lpCommentsField.addEventListener("input", () => {
        updateLpCommentsCharCount();
        autoSaveLpComments();
      });

      // Initial load
      updateLpCommentsCharCount();
      loadLpComments();
    }
    // ===== SAVE ALL FUNCTION =====
    async function saveAllChanges() {
      let savedCount = 0;
      const errors = [];
      const verificationResults = [];

      try {
        if (!CURRENT_DCL_ID || !isGuid(CURRENT_DCL_ID)) {
          throw new Error("Invalid DCL ID");
        }

        // ===== 1. SAVE LP COMMENTS WITH VERIFICATION =====
        if (lpCommentsField && lpCommentsField.value.trim()) {
          try {
            const commentText = lpCommentsField.value.trim();
            const payload = { cr650_additionalco_lp: commentText };
            
            // Save
            await safeAjax({
              type: "PATCH",
              url: `${DCL_MASTER_API}(${CURRENT_DCL_ID})`,
              data: JSON.stringify(payload),
              contentType: "application/json; charset=utf-8",
              headers: { Accept: "application/json;odata.metadata=minimal", "If-Match": "*" },
              dataType: "json",
              _withLoader: false
            });

            // ✅ VERIFY: Fetch back and compare
            const verifyData = await safeAjax({
              type: "GET",
              url: `${DCL_MASTER_API}(${CURRENT_DCL_ID})?$select=cr650_additionalco_lp`,
              headers: { Accept: "application/json;odata.metadata=minimal" },
              dataType: "json",
              _withLoader: false
            });

            const savedComment = verifyData.cr650_additionalco_lp || "";
            
            if (savedComment === commentText) {
              savedCount++;
              verificationResults.push({
                type: "comments",
                verified: true,
                message: "Comments verified in Dataverse"
              });
              console.log("✅ LP comments saved and verified");
            } else {
              throw new Error(`Verification failed: Saved "${savedComment}" but expected "${commentText}"`);
            }

          } catch (err) {
            console.error("❌ LP comments failed:", err);
            errors.push({
              type: "Comments",
              error: err.message,
              verified: false
            });
          }
        }

        // ===== 2. SAVE EDITED ROWS WITH VERIFICATION =====
        const editingRows = QA("#itemsTableBody tr.lp-data-row .row-save");
        
        if (editingRows.length > 0) {
          for (const btn of editingRows) {
            try {
              const tr = btn.closest("tr");
              const serverId = tr.dataset.serverId;
              
              // Get expected values BEFORE save
              const expectedQty = asNum(tr.querySelector(".loading-qty")?.value);
              const expectedItem = (tr.querySelector(".item-code")?.textContent || "").trim();
              
              // Save
              await saveRowEdits(tr);
              
              // ✅ VERIFY: Fetch back and compare
              if (serverId && isGuid(serverId)) {
                const verifyData = await safeAjax({
                  type: "GET",
                  url: `${DCL_LP_API}(${serverId})?$select=cr650_loadedquantity,cr650_itemcode`,
                  headers: { Accept: "application/json;odata.metadata=minimal" },
                  dataType: "json",
                  _withLoader: false
                });

                const savedQty = asNum(verifyData.cr650_loadedquantity);
                const savedItem = (verifyData.cr650_itemcode || "").trim();

                if (Math.abs(savedQty - expectedQty) < 0.01 && savedItem === expectedItem) {
                  savedCount++;
                  verificationResults.push({
                    type: "row",
                    item: expectedItem,
                    verified: true,
                    message: `Row verified: ${expectedItem} - ${expectedQty} units`
                  });
                  console.log(`✅ Row saved and verified: ${expectedItem}`);
                } else {
                  throw new Error(
                    `Verification failed: Expected qty ${expectedQty}, got ${savedQty}. ` +
                    `Expected item "${expectedItem}", got "${savedItem}"`
                  );
                }
              } else {
                // New row without ID yet - consider it saved if no error
                savedCount++;
                verificationResults.push({
                  type: "row",
                  verified: false,
                  message: "New row created (ID not yet available for verification)"
                });
              }

            } catch (err) {
              console.error("❌ Row save failed:", err);
              errors.push({
                type: "Order item",
                error: err.message,
                verified: false
              });
            }
          }
        }

        // ===== 3. BUILD DETAILED RESPONSE =====
        const totalAttempted = (lpCommentsField?.value ? 1 : 0) + editingRows.length;
        const totalFailed = errors.length;
        const totalVerified = verificationResults.filter(r => r.verified).length;

        let message = "";
        if (savedCount > 0) {
          message = `✅ Saved ${savedCount} item(s)`;
          if (totalVerified > 0) {
            message += ` (${totalVerified} verified in Dataverse)`;
          }
        }
        
        if (totalFailed > 0) {
          message += `\n❌ Failed: ${totalFailed} item(s)`;
          errors.forEach(e => {
            message += `\n  • ${e.type}: ${e.error}`;
          });
        }

        if (totalAttempted === 0) {
          message = "No changes to save";
        }

        const success = totalAttempted > 0 && totalFailed === 0;

        return {
          success,
          attempted: totalAttempted,
          succeeded: savedCount,
          failed: totalFailed,
          verified: totalVerified,
          message,
          verificationResults,
          errors
        };

      } catch (err) {
        console.error("❌ Unexpected error:", err);
        return {
          success: false,
          attempted: 0,
          succeeded: 0,
          failed: 0,
          verified: 0,
          message: "Critical error: " + err.message,
          verificationResults: [],
          errors: [{ type: "System", error: err.message }]
        };
      }
    }
    // ===== "SAVE & NEXT" BUTTON =====
    const saveAndNextBtn = Q("#saveAndNextBtn");
    if (saveAndNextBtn) {
      saveAndNextBtn.addEventListener("click", async () => {
        
        // Show loading state
        saveAndNextBtn.disabled = true;
        const originalHTML = saveAndNextBtn.innerHTML;
        saveAndNextBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        // Save everything
        const result = await saveAllChanges();
        
        // Restore button
        saveAndNextBtn.disabled = false;
        saveAndNextBtn.innerHTML = originalHTML;
        
        if (result.success) {
          // ✅ SUCCESS: Keep it simple
          showNotificationToast({
            type: "success",
            title: "✓ All Changes Saved",
            message: "Proceeding to next step...",
            duration: 2000
          });
          
          setTimeout(() => {
            window.location.href = `/DCL-Document-Generator?id=${CURRENT_DCL_ID}`;
          }, 1000);
          
        } else {
          // ❌ ERROR: Show helpful details
          const failedItems = [];
          
          // Collect what failed
          if (result.errors && result.errors.length > 0) {
            result.errors.forEach(err => {
              if (err.type === "Comments") {
                failedItems.push("Loading Plan comments");
              } else if (err.type === "Order item") {
                failedItems.push(err.item || "Order item");
              } else {
                failedItems.push(err.type);
              }
            });
          }
          
          const errorMessage = failedItems.length > 0
            ? `Could not save:\n• ${failedItems.join("\n• ")}`
            : "An error occurred. Please try again.";
          
          showNotificationToast({
            type: "error",
            title: "❌ Save Failed",
            message: errorMessage,
            duration: 5000
          });
        }
      });
    }
    // ===== TOP NAVIGATION LINKS =====
    const stepLinks = QA('#stepIndicators a');
    stepLinks.forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const targetUrl = link.href;
        
        // Save everything
        const success = await saveAllChanges();
        
        if (success) {
          showNotificationToast({
            type: "success",
            title: "✓ All Changes Saved Successfully",
            message: "Navigating...",
            duration: 1500
          });
          
          setTimeout(() => {
            window.location.href = targetUrl;
          }, 800);
        } else {
          showNotificationToast({
            type: "error",
            title: "Save Failed",
            message: "Cannot navigate - please try again",
            duration: 4000
          });
        }
      });
    });

    // ===== WIZARD STEPS NAVIGATION (if you have radio buttons) =====
    const stepRadios = QA('input[name="wizardStep"]');
    const sections = QA(".wizard-step");

    if (stepRadios.length > 0 && sections.length > 0) {
      stepRadios.forEach((radio, i) => {
        radio.addEventListener("change", () => {
          if (radio.checked) {
            const val = Number(radio.value);
            sections.forEach((sec, j) => {
              sec.style.display = (j === val - 1) ? "block" : "none";
            });
          }
        });
      });

      // Initialize first step
      if (stepRadios[0]) stepRadios[0].checked = true;
      sections.forEach((sec, i) => {
        sec.style.display = (i === 0) ? "block" : "none";
      });
    }

    // ===== INITIAL CALCULATIONS =====
    // Don't call recalcAllRows() - preserve saved values from Dataverse (like manually set gross weight)
    recomputeTotals();
  });

  // ============================================================
  // 🟢 UNRELEASED ORDERS CHECK - ADD THIS ENTIRE SECTION
  // ============================================================

  async function checkUnreleasedOrders(dclId) {
    try {
      console.log("🔍 Checking for unreleased orders...");

      const response = await fetch(
        `/_api/cr650_dcl_loading_plans?$filter=_cr650_dcl_number_value eq ${dclId}` +
        `&$select=cr650_ordernumber,cr650_itemcode,cr650_itemdescription,cr650_releasestatus,cr650_loadedquantity`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        console.error('Failed to fetch loading plan items');
        return true;
      }

      const data = await response.json();
      const items = data.value || [];

      if (items.length === 0) {
        return true;
      }

      // Group unreleased items by order number
      const unreleasedOrdersMap = new Map();

      items.forEach(item => {
        const releaseStatus = item.cr650_releasestatus;
        const orderNumber = item.cr650_ordernumber;

        // Adjust this logic to match your field values
        const isNotReleased = releaseStatus !== 'Y' && releaseStatus !== 0;

        if (isNotReleased && orderNumber) {
          if (!unreleasedOrdersMap.has(orderNumber)) {
            unreleasedOrdersMap.set(orderNumber, []);
          }
          unreleasedOrdersMap.get(orderNumber).push({
            itemCode: item.cr650_itemcode || 'N/A',
            description: item.cr650_itemdescription || 'No description',
            quantity: item.cr650_loadedquantity || 0
          });
        }
      });

      if (unreleasedOrdersMap.size === 0) {
        console.log('✅ All orders are released');
        return true;
      }

      // Show professional modal
      return showUnreleasedDialog(unreleasedOrdersMap);

    } catch (error) {
      console.error('Error checking unreleased orders:', error);
      return true;
    }
  }

  function showUnreleasedDialog(ordersMap) {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'unreleased-overlay';

      // Build order cards HTML
      let ordersHTML = '';
      let itemCount = 0;

      ordersMap.forEach((items, orderNumber) => {
        itemCount += items.length;
        const itemsHTML = items.map(item => `
          <div class="unreleased-item">
            <div class="unreleased-item-icon">
              <i class="fas fa-box"></i>
            </div>
            <div class="unreleased-item-details">
              <div class="unreleased-item-code">${escapeHtml(item.itemCode)}</div>
              <div class="unreleased-item-desc">${escapeHtml(item.description)}</div>
              <div class="unreleased-item-qty">Qty: ${item.quantity}</div>
            </div>
          </div>
        `).join('');

        ordersHTML += `
          <div class="unreleased-order-card">
            <div class="unreleased-order-header">
              <div class="unreleased-order-number">
                <i class="fas fa-file-invoice"></i>
                Order #${escapeHtml(orderNumber)}
              </div>
              <div class="unreleased-order-badge">Not Released</div>
            </div>
            <div class="unreleased-items-list">
              ${itemsHTML}
            </div>
          </div>
        `;
      });

      overlay.innerHTML = `
        <div class="unreleased-modal">
          <div class="unreleased-header">
            <div class="unreleased-header-icon">
              <i class="fas fa-exclamation-triangle"></i>
            </div>
            <h3 class="unreleased-title">Unreleased Orders Detected</h3>
            <p class="unreleased-subtitle">
              ${ordersMap.size} order${ordersMap.size > 1 ? 's' : ''} with ${itemCount} item${itemCount > 1 ? 's' : ''} not released
            </p>
          </div>
          
          <div class="unreleased-alert">
            <i class="fas fa-info-circle"></i>
            <span>Generating the loading plan with unreleased orders may cause issues in the shipment process.</span>
          </div>
          
          <div class="unreleased-content">
            ${ordersHTML}
          </div>
          
          <div class="unreleased-footer">
            <button class="unreleased-btn unreleased-btn-cancel">
              <i class="fas fa-times"></i>
              Cancel
            </button>
            <button class="unreleased-btn unreleased-btn-proceed">
              <i class="fas fa-check"></i>
              Proceed Anyway
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Add animation
      setTimeout(() => overlay.classList.add('show'), 10);

      // Event handlers
      const cancelBtn = overlay.querySelector('.unreleased-btn-cancel');
      const proceedBtn = overlay.querySelector('.unreleased-btn-proceed');

      function closeModal(shouldProceed) {
        overlay.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(overlay);
          resolve(shouldProceed);
        }, 300);
      }

      cancelBtn.addEventListener('click', () => closeModal(false));
      proceedBtn.addEventListener('click', () => closeModal(true));

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeModal(false);
        }
      });

      // Close on ESC key
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', escHandler);
          closeModal(false);
        }
      };
      document.addEventListener('keydown', escHandler);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Expose to window
  window.checkUnreleasedOrders = checkUnreleasedOrders;

})(window, document);  